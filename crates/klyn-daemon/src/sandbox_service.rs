//! Daemon-owned sandbox setup for one exact klyn-fs candidate transaction.
//!
//! The service signs a short-lived, transaction-specific OCap token, writes
//! private manifests, starts a broker scoped to that candidate, and launches
//! the trusted bootstrap behind a cgroup-before-release gate. No IPC request
//! can choose the executable, cgroup root, signing key or resource budget.

use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::ExitStatus,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::SigningKey;
use klyn_sandbox::{
    broker::{BrokerConfig, Ed25519CapabilityVerifier, ResourceBroker, RevocationOracle},
    candidate_root_id,
    supervisor::{launch_gated_worker, SandboxedChild, WorkerLaunchSpec},
    CapabilityClaims, CapabilityIssuer, FileAccess, FileGrant, ResourceBudget, SandboxError,
    OCAP_VERSION,
};
use serde::Serialize;
use thiserror::Error;

use crate::fs_service::{FsService, FsServiceError};

static NEXT_WORKER: AtomicU64 = AtomicU64::new(1);
const TOKEN_LIFETIME_SECONDS: u64 = 10 * 60;
const PRIVATE_MANIFEST_LIMIT: usize = klyn_sandbox::MAX_BROKER_FRAME_BYTES;

#[derive(Debug, Error)]
pub enum SandboxServiceError {
    #[error(transparent)]
    Sandbox(#[from] SandboxError),
    #[error("sandbox filesystem I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("candidate transaction is not active or cannot be resolved")]
    CandidateUnavailable,
    #[error("sandbox broker thread could not be started")]
    BrokerThreadStart,
    #[error("sandbox broker thread failed")]
    BrokerThreadFailed,
    #[error("sandbox worker is already finished")]
    WorkerFinished,
}

/// All paths in this struct are daemon/operator configuration, never IPC input.
pub struct SandboxServiceConfig {
    pub trusted_bootstrap: PathBuf,
    pub gate_directory: PathBuf,
    pub delegated_cgroup_root: PathBuf,
    pub broker_directory: PathBuf,
    pub manifest_directory: PathBuf,
    pub startup_timeout: Duration,
    pub max_broker_workers: usize,
    pub broker_queue_capacity: usize,
}

pub struct SandboxService {
    config: SandboxServiceConfig,
    fs_service: Arc<FsService>,
    issuer: CapabilityIssuer,
    revocations: Arc<dyn RevocationOracle>,
}

impl SandboxService {
    pub fn new(
        config: SandboxServiceConfig,
        fs_service: Arc<FsService>,
        signing_key: SigningKey,
        revocations: Arc<dyn RevocationOracle>,
    ) -> Result<Self, SandboxError> {
        klyn_sandbox::validate_trusted_executable(&config.trusted_bootstrap)?;
        if config.startup_timeout.is_zero() || config.startup_timeout > Duration::from_secs(30) {
            return Err(SandboxError::InvalidConfig(
                "startup timeout must be between 1ms and 30s".into(),
            ));
        }
        if config.max_broker_workers == 0 || config.broker_queue_capacity == 0 {
            return Err(SandboxError::InvalidConfig(
                "broker worker and queue limits must be non-zero".into(),
            ));
        }
        ensure_private_directory(&config.gate_directory)?;
        ensure_private_directory(&config.broker_directory)?;
        ensure_private_directory(&config.manifest_directory)?;

        let cgroup_root = fs::canonicalize(&config.delegated_cgroup_root)?;
        if !cgroup_root.is_dir() {
            return Err(SandboxError::InvalidConfig(
                "delegated cgroup-v2 root is not a directory".into(),
            ));
        }

        let host_uid = nix::unistd::geteuid().as_raw();
        let host_gid = nix::unistd::getegid().as_raw();
        if host_uid == 0 || host_gid == 0 {
            return Err(SandboxError::InvalidConfig(
                "sandbox daemon must run under a dedicated non-root UID/GID".into(),
            ));
        }

        Ok(Self {
            config: SandboxServiceConfig {
                trusted_bootstrap: fs::canonicalize(&config.trusted_bootstrap)?,
                gate_directory: fs::canonicalize(&config.gate_directory)?,
                delegated_cgroup_root: cgroup_root,
                broker_directory: fs::canonicalize(&config.broker_directory)?,
                manifest_directory: fs::canonicalize(&config.manifest_directory)?,
                startup_timeout: config.startup_timeout,
                max_broker_workers: config.max_broker_workers,
                broker_queue_capacity: config.broker_queue_capacity,
            },
            fs_service,
            issuer: CapabilityIssuer::new(signing_key),
            revocations,
        })
    }

    /// Launch a minimal broker-driven worker for one active klyn-fs transaction.
    ///
    /// The worker protocol supports ping, read_file, write_candidate_file and
    /// shutdown. It intentionally does not execute arbitrary model-supplied
    /// binaries; such execution must be implemented inside a separately audited
    /// runtime that preserves the same seccomp/capability boundary.
    pub fn launch_candidate_worker(
        &self,
        transaction_id: &str,
        budget: ResourceBudget,
    ) -> Result<ManagedSandboxedWorker, SandboxServiceError> {
        budget.validate()?;
        let cgroup_id = transaction_id.to_owned();
        let root_id = candidate_root_id(&cgroup_id)?;

        let candidate_path = self
            .fs_service
            .candidate_path_for_transaction(transaction_id)
            .map_err(map_fs_error)?;
        let candidate_path = fs::canonicalize(candidate_path)?;
        if !candidate_path.is_dir() {
            return Err(SandboxError::InvalidConfig(
                "candidate transaction path is not a directory".into(),
            )
            .into());
        }

        let mut roots = BTreeMap::new();
        roots.insert(root_id.clone(), candidate_path);

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| SandboxError::Enforcement("system clock precedes Unix epoch".into()))?
            .as_secs();
        let sequence = NEXT_WORKER.fetch_add(1, Ordering::Relaxed);
        let host_uid = nix::unistd::geteuid().as_raw();
        let host_gid = nix::unistd::getegid().as_raw();
        let claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id: format!("worker-{now:x}-{:x}-{sequence:x}", std::process::id()),
            subject_uid: host_uid,
            subject_gid: host_gid,
            expires_at_unix: now
                .checked_add(TOKEN_LIFETIME_SECONDS)
                .ok_or_else(|| SandboxError::InvalidConfig("token expiry overflow".into()))?,
            file_grants: vec![FileGrant {
                root_id: root_id.clone(),
                prefix: String::new(),
                access: FileAccess::Read,
            }],
            candidate_transaction_id: Some(transaction_id.to_owned()),
            candidate_write_enabled: true,
            network_grants: Vec::new(),
            budget,
        };
        let token = self.issuer.issue(claims)?;
        let public_key = self.issuer.verifying_key().to_bytes();
        let public_key_hex = public_key
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();

        let stem = format!("worker-{sequence:x}-{}", std::process::id());
        let capability_manifest = self
            .config
            .manifest_directory
            .join(format!("{stem}.cap.json"));
        let roots_manifest = self
            .config
            .manifest_directory
            .join(format!("{stem}.roots.json"));
        let socket_path = self.config.broker_directory.join(format!("{stem}.sock"));

        write_private_json_new(&capability_manifest, &token)?;
        if let Err(error) = write_private_json_new(&roots_manifest, &roots) {
            let _ = fs::remove_file(&capability_manifest);
            return Err(error.into());
        }

        let broker = match ResourceBroker::bind(BrokerConfig {
            socket_path: socket_path.clone(),
            roots,
            verifier: Arc::new(Ed25519CapabilityVerifier::new(self.issuer.verifying_key())),
            revocations: Arc::clone(&self.revocations),
            mutation_handler: self.fs_service.clone(),
            max_workers: self.config.max_broker_workers,
            queue_capacity: self.config.broker_queue_capacity,
        }) {
            Ok(broker) => broker,
            Err(error) => {
                let _ = fs::remove_file(&capability_manifest);
                let _ = fs::remove_file(&roots_manifest);
                return Err(error.into());
            }
        };

        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let broker_thread = match std::thread::Builder::new()
            .name(format!("klyn-broker-{sequence}"))
            .spawn(move || broker.serve_until(thread_stop))
        {
            Ok(thread) => thread,
            Err(_) => {
                let _ = fs::remove_file(&capability_manifest);
                let _ = fs::remove_file(&roots_manifest);
                return Err(SandboxServiceError::BrokerThreadStart);
            }
        };

        let launch = launch_gated_worker(WorkerLaunchSpec {
            executable: self.config.trusted_bootstrap.clone(),
            args: Vec::new(),
            gate_directory: self.config.gate_directory.clone(),
            cgroup_root: self.config.delegated_cgroup_root.clone(),
            cgroup_id,
            budget: token.claims.budget.clone(),
            startup_timeout: self.config.startup_timeout,
            capability_manifest: capability_manifest.clone(),
            broker_socket: socket_path,
            roots_manifest: roots_manifest.clone(),
            verifying_key_hex: public_key_hex,
            host_uid,
            host_gid,
        });

        match launch {
            Ok(worker) => Ok(ManagedSandboxedWorker {
                worker: Some(worker),
                stop,
                broker_thread: Some(broker_thread),
                manifest_paths: vec![capability_manifest, roots_manifest],
            }),
            Err(error) => {
                stop.store(true, Ordering::Release);
                let _ = broker_thread.join();
                let _ = fs::remove_file(&capability_manifest);
                let _ = fs::remove_file(&roots_manifest);
                Err(error.into())
            }
        }
    }
}

pub struct ManagedSandboxedWorker {
    worker: Option<SandboxedChild>,
    stop: Arc<AtomicBool>,
    broker_thread: Option<JoinHandle<Result<(), SandboxError>>>,
    manifest_paths: Vec<PathBuf>,
}

impl ManagedSandboxedWorker {
    pub fn pid(&self) -> Result<u32, SandboxServiceError> {
        self.worker
            .as_ref()
            .map(SandboxedChild::id)
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
        if let Some(worker) = self.worker.as_mut() {
            worker.send_json(&serde_json::json!({"op": "shutdown"}))?;
            let _ = worker.read_json_response()?;
            worker.close_stdin();
        }
        let status = self
            .worker
            .as_mut()
            .ok_or(SandboxServiceError::WorkerFinished)?
            .wait()?;
        self.worker.take();
        self.stop_and_join_broker()?;
        self.remove_manifests();
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

    fn remove_manifests(&self) {
        for path in &self.manifest_paths {
            let _ = fs::remove_file(path);
        }
    }
}

impl Drop for ManagedSandboxedWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        // SandboxedChild's Drop kills the cgroup and reaps the launcher.
        self.worker.take();
        if let Some(thread) = self.broker_thread.take() {
            let _ = thread.join();
        }
        self.remove_manifests();
    }
}

fn map_fs_error(_error: FsServiceError) -> SandboxError {
    SandboxError::InvalidConfig("candidate transaction is not active".into())
}

fn ensure_private_directory(path: &Path) -> Result<(), SandboxError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(SandboxError::InvalidConfig(
                "sandbox runtime directory must not be a symlink".into(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(SandboxError::InvalidConfig(
                "sandbox runtime path is not a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
        }
        Err(error) => return Err(SandboxError::Io(error)),
    }

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    let euid = nix::unistd::geteuid().as_raw();
    if metadata.mode() & 0o077 != 0 || (metadata.uid() != 0 && metadata.uid() != euid) {
        return Err(SandboxError::InvalidConfig(format!(
            "sandbox runtime directory is not daemon-private: {}",
            canonical.display()
        )));
    }
    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory)?;
        if metadata.mode() & 0o022 != 0 || (metadata.uid() != 0 && metadata.uid() != euid) {
            return Err(SandboxError::InvalidConfig(format!(
                "sandbox runtime directory has an untrusted ancestor: {}",
                directory.display()
            )));
        }
        parent = directory.parent();
    }
    Ok(())
}

fn write_private_json_new(path: &Path, value: &impl Serialize) -> Result<(), SandboxError> {
    let parent = path
        .parent()
        .ok_or_else(|| SandboxError::InvalidConfig("manifest path has no parent".into()))?;
    let bytes = serde_json::to_vec(value)?;
    if bytes.is_empty() || bytes.len() > PRIVATE_MANIFEST_LIMIT {
        return Err(SandboxError::InvalidConfig(
            "worker manifest is empty or exceeds the size limit".into(),
        ));
    }

    let temporary = parent.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        NEXT_WORKER.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)?;
    let result = (|| -> Result<(), SandboxError> {
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
