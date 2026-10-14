//! Linux daemon adapter for the canonical PR #79 worker lifecycle.
//!
//! The worker is admitted only for an active, owner-authenticated transaction.
//! Until RuntimeLeaseV1 and mandatory KEL dispatch evidence are integrated, the
//! worker receives a separately provisioned read-only runtime root; it does not
//! receive the live candidate worktree or write authority.

use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::ExitStatus,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{Signer, SigningKey};
use klyn_sandbox::{
    broker::{BrokerConfig, Ed25519CapabilityVerifier, ResourceBroker, RevocationOracle},
    supervisor::{launch_worker, SpawnedWorker, WorkerLaunchConfig},
    validate_trusted_root, CapabilityClaims, FileAccess, FileGrant, ResourceBudget, SandboxError,
    SignedCapability, OCAP_VERSION,
};
use thiserror::Error;

use crate::{
    fs_service::{FsService, FsServiceError},
    policy::PeerIdentity,
};

static NEXT_WORKER: AtomicU64 = AtomicU64::new(1);
const TOKEN_LIFETIME_SECONDS: u64 = 600;

#[derive(Debug, Error)]
pub enum SandboxServiceError {
    #[error(transparent)]
    Sandbox(#[from] SandboxError),
    #[error(transparent)]
    Filesystem(#[from] FsServiceError),
    #[error("sandbox service I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("sandbox service requires a dedicated non-root daemon UID/GID")]
    RootDaemon,
    #[error("sandbox transaction ID is invalid or too long")]
    TransactionIdInvalid,
    #[error("worker has already exited")]
    WorkerFinished,
    #[error("broker thread could not be started")]
    BrokerThreadStart,
    #[error("broker thread panicked")]
    BrokerThreadFailed,
    #[error("worker did not acknowledge shutdown")]
    ShutdownNotAcknowledged,
}

/// All paths are trusted operator configuration, never IPC parameters.
/// trusted_read_only_root must be root-owned and non-writable. It is deliberately
/// separate from the transaction worktree until OCap/KEL write mediation lands.
pub struct SandboxServiceConfig {
    pub init_executable: PathBuf,
    pub worker_executable: PathBuf,
    pub trusted_read_only_root: PathBuf,
    pub delegated_cgroup_root: PathBuf,
    pub broker_directory: PathBuf,
    pub max_broker_workers: usize,
    pub broker_queue_capacity: usize,
    pub cpu_weight: u32,
}

pub struct SandboxService {
    config: SandboxServiceConfig,
    fs_service: Arc<FsService>,
    signing_key: SigningKey,
    revocations: Arc<dyn RevocationOracle>,
}

impl SandboxService {
    pub fn new(
        config: SandboxServiceConfig,
        fs_service: Arc<FsService>,
        signing_key: SigningKey,
        revocations: Arc<dyn RevocationOracle>,
    ) -> Result<Self, SandboxServiceError> {
        let uid = nix::unistd::geteuid().as_raw();
        let gid = nix::unistd::getegid().as_raw();
        if uid == 0 || gid == 0 {
            return Err(SandboxServiceError::RootDaemon);
        }
        if config.max_broker_workers == 0
            || config.broker_queue_capacity == 0
            || !(1..=10_000).contains(&config.cpu_weight)
        {
            return Err(SandboxError::InvalidConfig(
                "broker limits and CPU weight must be within their valid bounds".into(),
            )
            .into());
        }

        klyn_sandbox::validate_trusted_executable(&config.worker_executable)?;
        let runtime_root = validate_trusted_root(&config.trusted_read_only_root)?;
        let runtime_meta = fs::metadata(&runtime_root)?;
        if runtime_meta.uid() != 0 || runtime_meta.mode() & 0o222 != 0 {
            return Err(SandboxError::InvalidConfig(
                "trusted read-only root must be root-owned and non-writable".into(),
            )
            .into());
        }
        let cgroup_root = fs::canonicalize(&config.delegated_cgroup_root)?;
        if !cgroup_root.is_dir() {
            return Err(SandboxError::InvalidConfig(
                "delegated cgroup-v2 root is not a directory".into(),
            )
            .into());
        }
        let broker_directory = ensure_private_directory(&config.broker_directory)?;
        let init_executable = fs::canonicalize(&config.init_executable)?;

        Ok(Self {
            config: SandboxServiceConfig {
                init_executable,
                worker_executable: fs::canonicalize(&config.worker_executable)?,
                trusted_read_only_root: runtime_root,
                delegated_cgroup_root: cgroup_root,
                broker_directory,
                max_broker_workers: config.max_broker_workers,
                broker_queue_capacity: config.broker_queue_capacity,
                cpu_weight: config.cpu_weight,
            },
            fs_service,
            signing_key,
            revocations,
        })
    }

    /// Launch the bounded bootstrap worker for one active transaction. No
    /// candidate path, Git metadata, or write descriptor is exposed to it.
    pub fn launch_candidate_worker(
        &self,
        transaction_id: &str,
        peer: PeerIdentity,
        budget: ResourceBudget,
    ) -> Result<ManagedSandboxedWorker, SandboxServiceError> {
        budget.validate()?;
        if transaction_id.is_empty() || transaction_id.len() > 180 {
            return Err(SandboxServiceError::TransactionIdInvalid);
        }

        // Enforce owner and active-transaction checks, but do not use this path
        // as a Landlock or broker root. The interim adapter is intentionally
        // read-only until the signed RuntimeLease and KEL authorization gate land.
        let candidate_path = self
            .fs_service
            .candidate_path_for_transaction(transaction_id, peer)?;
        if !candidate_path.is_dir() {
            return Err(SandboxError::InvalidConfig(
                "active candidate workspace is not a directory".into(),
            )
            .into());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| SandboxError::Enforcement("system clock precedes Unix epoch".into()))?
            .as_secs();
        let sequence = NEXT_WORKER.fetch_add(1, Ordering::Relaxed);
        let token_id = format!("worker-{transaction_id}-{sequence:x}");
        let host_uid = nix::unistd::geteuid().as_raw();
        let host_gid = nix::unistd::getegid().as_raw();
        let expires_at_unix = now
            .checked_add(TOKEN_LIFETIME_SECONDS)
            .ok_or_else(|| SandboxError::InvalidConfig("capability expiry overflow".into()))?;

        let claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id,
            subject_uid: host_uid,
            subject_gid: host_gid,
            expires_at_unix,
            file_grants: vec![FileGrant {
                root_id: "runtime".into(),
                prefix: String::new(),
                access: FileAccess::Read,
            }],
            network_grants: Vec::new(),
            budget,
        };
        claims.validate()?;
        let payload = serde_json::to_vec(&claims).map_err(SandboxError::from)?;
        let signature = self.signing_key.sign(&payload).to_bytes().to_vec();
        let capability = SignedCapability { claims, signature };

        let worker_id = format!("worker-{:x}-{:x}", std::process::id(), sequence);
        let socket_path = self
            .config
            .broker_directory
            .join(format!("{worker_id}.sock"));
        let roots = BTreeMap::from([(
            "runtime".to_owned(),
            self.config.trusted_read_only_root.clone(),
        )]);
        let broker = ResourceBroker::bind(BrokerConfig {
            socket_path: socket_path.clone(),
            roots: roots.clone(),
            verifier: Arc::new(Ed25519CapabilityVerifier::new(
                self.signing_key.verifying_key(),
            )),
            revocations: Arc::clone(&self.revocations),
            max_workers: self.config.max_broker_workers,
            queue_capacity: self.config.broker_queue_capacity,
        })?;

        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let broker_thread = std::thread::Builder::new()
            .name(format!("klyn-broker-{sequence:x}"))
            .spawn(move || broker.serve_until(thread_stop))
            .map_err(|_| SandboxServiceError::BrokerThreadStart)?;

        let launch = launch_worker(
            WorkerLaunchConfig {
                init_executable: self.config.init_executable.clone(),
                worker_executable: self.config.worker_executable.clone(),
                delegated_cgroup_root: self.config.delegated_cgroup_root.clone(),
                worker_id,
                broker_socket: socket_path,
                roots,
                capability,
                cpu_weight: self.config.cpu_weight,
            },
            &self.signing_key,
        );

        match launch {
            Ok(worker) => Ok(ManagedSandboxedWorker {
                worker: Some(worker),
                stop,
                broker_thread: Some(broker_thread),
            }),
            Err(error) => {
                stop.store(true, Ordering::Release);
                let _ = broker_thread.join();
                Err(error.into())
            }
        }
    }
}

pub struct ManagedSandboxedWorker {
    worker: Option<SpawnedWorker>,
    stop: Arc<AtomicBool>,
    broker_thread: Option<JoinHandle<Result<(), SandboxError>>>,
}

impl ManagedSandboxedWorker {
    pub fn pid(&self) -> Result<u32, SandboxServiceError> {
        self.worker
            .as_ref()
            .map(SpawnedWorker::pid)
            .ok_or(SandboxServiceError::WorkerFinished)
    }

    pub fn send_command(&mut self, command: &serde_json::Value) -> Result<(), SandboxServiceError> {
        self.worker
            .as_mut()
            .ok_or(SandboxServiceError::WorkerFinished)?
            .send_json(command)?;
        Ok(())
    }

    pub fn read_response(&mut self) -> Result<Option<serde_json::Value>, SandboxServiceError> {
        Ok(self
            .worker
            .as_mut()
            .ok_or(SandboxServiceError::WorkerFinished)?
            .read_json_response()?)
    }

    pub fn shutdown(mut self) -> Result<ExitStatus, SandboxServiceError> {
        self.send_command(&serde_json::json!({"op": "shutdown"}))?;
        let response = self
            .read_response()?
            .ok_or(SandboxServiceError::WorkerFinished)?;
        if response.get("ok") != Some(&serde_json::Value::Bool(true)) {
            return Err(SandboxServiceError::ShutdownNotAcknowledged);
        }
        let status = self
            .worker
            .as_mut()
            .ok_or(SandboxServiceError::WorkerFinished)?
            .wait()?;
        self.worker.take();
        self.stop_and_join_broker()?;
        Ok(status)
    }

    fn stop_and_join_broker(&mut self) -> Result<(), SandboxServiceError> {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.broker_thread.take() {
            thread
                .join()
                .map_err(|_| SandboxServiceError::BrokerThreadFailed)??;
        }
        Ok(())
    }
}

impl Drop for ManagedSandboxedWorker {
    fn drop(&mut self) {
        // Dropping SpawnedWorker kills its entire cgroup before broker join.
        self.worker.take();
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.broker_thread.take() {
            let _ = thread.join();
        }
    }
}

fn ensure_private_directory(path: &Path) -> Result<PathBuf, SandboxError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(SandboxError::InvalidConfig(
                "broker directory must not be a symlink".into(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(SandboxError::InvalidConfig(
                "broker path is not a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)?,
        Err(error) => return Err(SandboxError::Io(error)),
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    let uid = nix::unistd::geteuid().as_raw();
    if metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err(SandboxError::InvalidConfig(
            "broker directory must be daemon-owned and private".into(),
        ));
    }
    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory)?;
        if metadata.mode() & 0o022 != 0 && metadata.mode() & 0o1000 == 0 {
            return Err(SandboxError::InvalidConfig(format!(
                "broker directory has an unsafe writable ancestor: {}",
                directory.display()
            )));
        }
        if directory == Path::new("/") {
            break;
        }
        parent = directory.parent();
    }
    Ok(canonical)
}
