//! Fail-closed daemon entry point for all remote task execution.
//! Client input is a bounded task payload, never a command, binary path, UID/GID,
//! root path, resource budget, network grant, or capability.
use std::{
    collections::BTreeMap,
    io::{self, Cursor, Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{Signer, SigningKey};
use klyn_protocol::{
    read_frame, ExecuteTaskParams, ExecuteTaskResult, MAX_EXECUTION_RESULT_BYTES,
    MAX_EXECUTION_TASK_BYTES,
};
use klyn_sandbox::{
    launch_worker, validate_trusted_root, CapabilityClaims, FileGrant, NetworkGrant,
    ResourceBudget, SandboxError, SignedCapability, WorkerLaunchConfig, OCAP_VERSION,
};
use thiserror::Error;

use crate::policy::PeerIdentity;

const MIN_EXECUTION_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_EXECUTION_TIMEOUT: Duration = Duration::from_secs(300);
const MIN_CAPABILITY_OVERHEAD: Duration = Duration::from_secs(5);
const MAX_CAPABILITY_TTL: Duration = Duration::from_secs(3600);

#[derive(Clone, Debug)]
pub struct ExecutionServiceConfig {
    pub init_executable: PathBuf,
    pub worker_executable: PathBuf,
    pub delegated_cgroup_root: PathBuf,
    pub broker_socket: PathBuf,
    pub roots: BTreeMap<String, PathBuf>,
    /// Dedicated unprivileged identity, fixed by daemon deployment policy.
    pub worker_uid: u32,
    pub worker_gid: u32,
    pub file_grants: Vec<FileGrant>,
    pub network_grants: Vec<NetworkGrant>,
    pub budget: ResourceBudget,
    pub cpu_weight: u32,
    pub worker_id_prefix: String,
    pub execution_timeout: Duration,
    pub capability_ttl: Duration,
}

pub struct ExecutionService {
    config: ExecutionServiceConfig,
    signing_key: SigningKey,
    next_id: AtomicU64,
}

#[derive(Debug, Error)]
pub enum ExecutionError {
    #[error("execution service configuration is invalid: {0}")]
    InvalidConfig(String),
    #[error("task parameters are invalid")]
    InvalidTask,
    #[error("sandbox supervisor rejected execution")]
    Supervisor(#[from] SandboxError),
    #[error("worker I/O failed")]
    Io(#[from] io::Error),
    #[error("worker exceeded the execution deadline")]
    Timeout,
    #[error("worker exceeded the result-size limit")]
    OutputTooLarge,
    #[error("worker exited unsuccessfully")]
    WorkerFailed,
    #[error("worker result frame is malformed or mismatched")]
    InvalidWorkerResponse,
    #[error("system clock could not be validated")]
    Clock,
    #[error("capability serialization failed")]
    CapabilitySerialization(#[from] serde_json::Error),
}

impl ExecutionService {
    /// Validate the trusted profile at daemon startup. A bad configuration
    /// prevents execution from being enabled; it never triggers an unsandboxed fallback.
    pub fn new(
        config: ExecutionServiceConfig,
        signing_key: SigningKey,
    ) -> Result<Self, ExecutionError> {
        if !config.init_executable.is_absolute()
            || !config.worker_executable.is_absolute()
            || !config.delegated_cgroup_root.is_absolute()
            || !config.broker_socket.is_absolute()
        {
            return Err(ExecutionError::InvalidConfig(
                "trusted executable, cgroup root, and broker paths must be absolute".into(),
            ));
        }
        if config.worker_uid == 0 || config.worker_gid == 0 {
            return Err(ExecutionError::InvalidConfig(
                "worker UID and GID must belong to a dedicated non-root identity".into(),
            ));
        }
        if config.budget.pids_max < 4 {
            return Err(ExecutionError::InvalidConfig(
                "worker pids.max must allow the init, worker, and runtime tasks".into(),
            ));
        }
        config.budget.validate()?;
        if !(1..=10_000).contains(&config.cpu_weight) {
            return Err(ExecutionError::InvalidConfig(
                "cgroup CPU weight must be in 1..=10000".into(),
            ));
        }
        if config.roots.is_empty() {
            return Err(ExecutionError::InvalidConfig(
                "at least one trusted filesystem root is required".into(),
            ));
        }
        for (id, root) in &config.roots {
            if id.is_empty() || id.len() > 128 {
                return Err(ExecutionError::InvalidConfig(
                    "filesystem root IDs must contain 1..=128 bytes".into(),
                ));
            }
            let canonical = validate_trusted_root(root)?;
            if canonical != *root {
                return Err(ExecutionError::InvalidConfig(format!(
                    "filesystem root must already be canonical: {}",
                    root.display()
                )));
            }
        }
        for grant in &config.file_grants {
            if !config.roots.contains_key(&grant.root_id) {
                return Err(ExecutionError::InvalidConfig(format!(
                    "file grant references unknown root ID: {}",
                    grant.root_id
                )));
            }
        }
        if config.worker_id_prefix.is_empty()
            || config.worker_id_prefix.len() > 16
            || !config.worker_id_prefix.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
            })
        {
            return Err(ExecutionError::InvalidConfig(
                "worker ID prefix must contain 1..=16 safe ASCII bytes".into(),
            ));
        }
        if config.execution_timeout < MIN_EXECUTION_TIMEOUT
            || config.execution_timeout > MAX_EXECUTION_TIMEOUT
            || config.capability_ttl < config.execution_timeout + MIN_CAPABILITY_OVERHEAD
            || config.capability_ttl > MAX_CAPABILITY_TTL
        {
            return Err(ExecutionError::InvalidConfig(
                "execution timeout or capability lifetime is outside the permitted range".into(),
            ));
        }

        Ok(Self {
            config,
            signing_key,
            next_id: AtomicU64::new(1),
        })
    }

    /// Sole daemon task-execution path. Router::dispatch must first authorize
    /// the SO_PEERCRED-derived peer with Permission::ExecuteTask.
    pub fn execute(
        &self,
        peer: PeerIdentity,
        params: ExecuteTaskParams,
    ) -> Result<ExecuteTaskResult, ExecutionError> {
        params.validate().map_err(|_| ExecutionError::InvalidTask)?;
        if serde_json::to_vec(&params.payload)?.len() > MAX_EXECUTION_TASK_BYTES {
            return Err(ExecutionError::InvalidTask);
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ExecutionError::Clock)?;
        let nonce = self.next_id.fetch_add(1, Ordering::Relaxed);
        if nonce == u64::MAX {
            return Err(ExecutionError::InvalidConfig(
                "execution identifier space is exhausted".into(),
            ));
        }
        let time_component = now.as_nanos() as u64;
        let worker_id = format!(
            "{}-{}-{:x}-{:x}",
            self.config.worker_id_prefix, peer.uid, time_component, nonce
        );
        let claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id: format!("exec-{}-{}-{:x}-{:x}", peer.uid, peer.pid, time_component, nonce),
            subject_uid: self.config.worker_uid,
            subject_gid: self.config.worker_gid,
            expires_at_unix: now.as_secs().saturating_add(self.config.capability_ttl.as_secs()),
            file_grants: self.config.file_grants.clone(),
            network_grants: self.config.network_grants.clone(),
            budget: self.config.budget.clone(),
        };
        claims.validate()?;
        let claim_bytes = serde_json::to_vec(&claims)?;
        let capability = SignedCapability {
            claims,
            signature: self.signing_key.sign(&claim_bytes).to_bytes().to_vec(),
        };

        let launch = WorkerLaunchConfig {
            init_executable: self.config.init_executable.clone(),
            worker_executable: self.config.worker_executable.clone(),
            delegated_cgroup_root: self.config.delegated_cgroup_root.clone(),
            worker_id,
            broker_socket: self.config.broker_socket.clone(),
            roots: self.config.roots.clone(),
            capability,
            cpu_weight: self.config.cpu_weight,
        };
        let mut worker = launch_worker(launch, &self.signing_key)?;
        let mut stdin = worker.take_stdin().ok_or_else(|| {
            ExecutionError::Supervisor(SandboxError::Enforcement(
                "supervisor did not provide the worker input pipe".into(),
            ))
        })?;
        let input = serde_json::to_vec(&params)?;
        if input.len() > MAX_EXECUTION_TASK_BYTES + 512 {
            let _ = worker.terminate();
            return Err(ExecutionError::InvalidTask);
        }
        stdin.write_all(&input)?;
        stdin.write_all(b"\n")?;
        stdin.flush()?;
        drop(stdin);

        let stdout = worker.take_stdout().ok_or_else(|| {
            ExecutionError::Supervisor(SandboxError::Enforcement(
                "supervisor did not provide the worker result pipe".into(),
            ))
        })?;
        let output_reader = thread::spawn(move || {
            let mut output = Vec::new();
            let mut limited = stdout.take((MAX_EXECUTION_RESULT_BYTES + 2) as u64);
            limited.read_to_end(&mut output)?;
            if output.len() > MAX_EXECUTION_RESULT_BYTES + 1 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "worker result exceeded configured bound",
                ));
            }
            Ok(output)
        });

        let deadline = Instant::now() + self.config.execution_timeout;
        let status = loop {
            if let Some(status) = worker.try_wait()? {
                break status;
            }
            if Instant::now() >= deadline {
                let cleanup = worker.terminate();
                let _ = output_reader.join();
                cleanup?;
                return Err(ExecutionError::Timeout);
            }
            thread::sleep(Duration::from_millis(10));
        };
        // A successful direct-child exit is not sufficient: wait() confirms
        // cgroup.kill completed and that the entire sandbox leaf is empty.
        let reaped_status = worker.wait()?;
        if !status.success() || !reaped_status.success() {
            let _ = output_reader.join();
            return Err(ExecutionError::WorkerFailed);
        }

        let output = match output_reader.join() {
            Ok(Ok(output)) => output,
            Ok(Err(error)) if error.kind() == io::ErrorKind::InvalidData => {
                return Err(ExecutionError::OutputTooLarge);
            }
            Ok(Err(error)) => return Err(ExecutionError::Io(error)),
            Err(_) => return Err(ExecutionError::WorkerFailed),
        };
        if output.is_empty() || !output.ends_with(b"\n") {
            return Err(ExecutionError::InvalidWorkerResponse);
        }
        let mut cursor = Cursor::new(output.as_slice());
        let frame =
            read_frame(&mut cursor).map_err(|_| ExecutionError::InvalidWorkerResponse)?;
        if cursor.position() as usize != output.len() {
            return Err(ExecutionError::InvalidWorkerResponse);
        }
        let result: ExecuteTaskResult = serde_json::from_slice(&frame)
            .map_err(|_| ExecutionError::InvalidWorkerResponse)?;
        if result.task_id != params.task_id || result.operation != params.operation {
            return Err(ExecutionError::InvalidWorkerResponse);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_configuration_rejects_root_workers() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let config = ExecutionServiceConfig {
            init_executable: "/usr/libexec/klyn/klyn-sandbox-init".into(),
            worker_executable: "/usr/libexec/klyn/klyn-worker".into(),
            delegated_cgroup_root: "/sys/fs/cgroup/klyn".into(),
            broker_socket: "/run/klyn/broker.sock".into(),
            roots: BTreeMap::from([("workspace".into(), "/var/lib/klyn/workspaces".into())]),
            worker_uid: 0,
            worker_gid: 1000,
            file_grants: vec![],
            network_grants: vec![],
            budget: ResourceBudget {
                memory_max_bytes: 64 * 1024 * 1024,
                cpu_quota_micros: 100_000,
                cpu_period_micros: 100_000,
                pids_max: 16,
                io_limits: vec![],
            },
            cpu_weight: 100,
            worker_id_prefix: "mission".into(),
            execution_timeout: Duration::from_secs(15),
            capability_ttl: Duration::from_secs(60),
        };
        assert!(ExecutionService::new(config, key).is_err());
    }
}
