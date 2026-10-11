//! KLYN daemon process entry point.
//!
//! All privileged configuration is supplied by trusted operator-owned files
//! and environment variables. The worker launch path is an in-process runtime
//! API, not a model-facing RPC method. Use --worker-smoke on a correctly
//! delegated Linux host to verify that the complete PID-namespace bootstrap
//! starts and that the worker reports PID 1 after Landlock/seccomp install.

use std::{
    env,
    error::Error,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
    time::Duration,
};

use ed25519_dalek::SigningKey;
use klyn_daemon::{
    fs_service::FsService,
    lifecycle::Lifecycle,
    policy::{Permission, UidPolicy},
    sandbox_service::{SandboxService, SandboxServiceConfig},
    server::{self, BoundSocket},
    Router,
};
use klyn_fs::{FsEngine, DEFAULT_PUBLICATION_REF};
use klyn_protocol::Method;
use klyn_sandbox::{broker::RevocationOracle, ResourceBudget};
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_CONFIG_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyConfig {
    grants: Vec<UidGrant>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UidGrant {
    uid: u32,
    permissions: Vec<PermissionName>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PermissionName {
    ObserveDaemon,
    ShutdownDaemon,
    FsBeginCandidate,
    FsMutateCandidate,
    FsValidateCandidate,
    FsPublishRevision,
    FsAbortCandidate,
}

impl PermissionName {
    fn permission(self) -> Permission {
        match self {
            Self::ObserveDaemon => Permission::ObserveDaemon,
            Self::ShutdownDaemon => Permission::ShutdownDaemon,
            Self::FsBeginCandidate => Permission::FsBeginCandidate,
            Self::FsMutateCandidate => Permission::FsMutateCandidate,
            Self::FsValidateCandidate => Permission::FsValidateCandidate,
            Self::FsPublishRevision => Permission::FsPublishRevision,
            Self::FsAbortCandidate => Permission::FsAbortCandidate,
        }
    }
}

struct FileRevocations {
    path: PathBuf,
}

impl RevocationOracle for FileRevocations {
    fn is_revoked(&self, token_id: &str) -> Result<bool, String> {
        let bytes = read_private_file(&self.path, MAX_CONFIG_BYTES)
            .map_err(|error| format!("revocation file unavailable: {error}"))?;
        let revoked: Vec<String> = serde_json::from_slice(&bytes)
            .map_err(|error| format!("revocation file is invalid: {error}"))?;
        Ok(revoked.iter().any(|entry| entry == token_id))
    }
}

struct Application {
    router: Arc<Router>,
    fs_service: Arc<FsService>,
    sandbox_service: Arc<SandboxService>,
    socket_path: PathBuf,
    drain_timeout: Duration,
}

fn main() -> ExitCode {
    match entrypoint() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("klyn-daemon: {error}");
            ExitCode::FAILURE
        }
    }
}

fn entrypoint() -> Result<(), Box<dyn Error>> {
    let application = initialize()?;
    if env::args().nth(1).as_deref() == Some("--worker-smoke") {
        run_worker_smoke(&application)?;
        return Ok(());
    }

    let socket = BoundSocket::bind(&application.socket_path)?;
    server::serve(socket, application.router, application.drain_timeout)?;
    Ok(())
}

fn initialize() -> Result<Application, Box<dyn Error>> {
    let daemon_uid = nix::unistd::geteuid().as_raw();
    let daemon_gid = nix::unistd::getegid().as_raw();
    if daemon_uid == 0 || daemon_gid == 0 {
        return Err(invalid_config("run klyn-daemon as a dedicated non-root host UID/GID").into());
    }

    let repository = required_absolute_path("KLYN_REPOSITORY")?;
    let state_directory = required_absolute_path("KLYN_FS_STATE_DIR")?;
    let socket_path = required_absolute_path("KLYN_DAEMON_SOCKET")?;
    let policy_path = required_absolute_path("KLYN_POLICY_FILE")?;
    let signing_key_path = required_absolute_path("KLYN_SIGNING_KEY_FILE")?;
    let revocation_path = required_absolute_path("KLYN_REVOCATION_FILE")?;
    let bootstrap_path = required_absolute_path("KLYN_SANDBOX_BOOTSTRAP")?;
    let gate_directory = required_absolute_path("KLYN_GATE_DIR")?;
    let cgroup_root = required_absolute_path("KLYN_CGROUP_ROOT")?;
    let broker_directory = required_absolute_path("KLYN_BROKER_DIR")?;
    let manifest_directory = required_absolute_path("KLYN_MANIFEST_DIR")?;

    let publication_ref =
        env::var("KLYN_PUBLICATION_REF").unwrap_or_else(|_| DEFAULT_PUBLICATION_REF.into());
    let startup_timeout =
        Duration::from_millis(optional_u64("KLYN_SANDBOX_STARTUP_TIMEOUT_MS", 5_000)?);
    let max_broker_workers = optional_usize("KLYN_BROKER_WORKERS", 4)?;
    let broker_queue_capacity = optional_usize("KLYN_BROKER_QUEUE_CAPACITY", 16)?;
    let drain_timeout = Duration::from_millis(optional_u64("KLYN_DRAIN_TIMEOUT_MS", 5_000)?);

    let policy_config: PolicyConfig =
        serde_json::from_slice(&read_private_file(&policy_path, MAX_CONFIG_BYTES)?)?;
    if policy_config.grants.is_empty() {
        return Err(invalid_config("policy file must contain at least one explicit grant").into());
    }
    let mut policy_grants = Vec::new();
    for grant in policy_config.grants {
        if grant.uid == 0 || grant.permissions.is_empty() {
            return Err(
                invalid_config("root UID and grants with no permissions are forbidden").into(),
            );
        }
        for permission in grant.permissions {
            policy_grants.push((grant.uid, permission.permission()));
        }
    }
    let policy = Arc::new(UidPolicy::from_grants(policy_grants));

    let key_bytes = read_private_file(&signing_key_path, 32)?;
    let key: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| invalid_config("signing key file must contain exactly 32 raw bytes"))?;
    let signing_key = SigningKey::from_bytes(&key);

    // FsEngine performs startup recovery before IPC starts and refuses a dirty
    // canonical checkout or a state directory that overlaps the repository.
    let fs_engine = FsEngine::open(&repository, &state_directory, &publication_ref)?;
    let fs_service = Arc::new(FsService::new(fs_engine));

    let revocations: Arc<dyn RevocationOracle> = Arc::new(FileRevocations {
        path: revocation_path,
    });
    // Check the revocation store now, not only on the first broker request.
    let _ = revocations
        .is_revoked("__startup_probe__")
        .map_err(|error| invalid_config(&error))?;

    let sandbox_service = Arc::new(SandboxService::new(
        SandboxServiceConfig {
            trusted_bootstrap: bootstrap_path,
            gate_directory,
            delegated_cgroup_root: cgroup_root,
            broker_directory,
            manifest_directory,
            startup_timeout,
            max_broker_workers,
            broker_queue_capacity,
        },
        Arc::clone(&fs_service),
        signing_key,
        revocations,
    )?);

    let lifecycle = Lifecycle::new();
    let router = Arc::new(Router::with_services(
        lifecycle,
        policy,
        Arc::clone(&fs_service),
        Arc::clone(&sandbox_service),
    ));

    Ok(Application {
        router,
        fs_service,
        sandbox_service,
        socket_path,
        drain_timeout,
    })
}

/// This opt-in mode verifies the end-to-end bootstrap without running any
/// generated commands: create a disposable empty candidate, start the worker,
/// require PID 1 inside the PID namespace, then shut down and abort the candidate.
fn run_worker_smoke(application: &Application) -> Result<(), Box<dyn Error>> {
    let created = application
        .fs_service
        .execute(Method::FsBegin, &json!({}))?;
    let transaction_id = created
        .get("transaction_id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_config("FsBegin response lacks transaction_id"))?
        .to_owned();

    let budget = ResourceBudget {
        memory_max_bytes: optional_u64("KLYN_WORKER_MEMORY_MAX_BYTES", 256 * 1024 * 1024)?,
        cpu_quota_micros: optional_u64("KLYN_WORKER_CPU_QUOTA_MICROS", 100_000)?,
        cpu_period_micros: optional_u64("KLYN_WORKER_CPU_PERIOD_MICROS", 100_000)?,
        pids_max: optional_u64("KLYN_WORKER_PIDS_MAX", 32)?
            .try_into()
            .map_err(|_| invalid_config("KLYN_WORKER_PIDS_MAX exceeds u32"))?,
        io_limits: Vec::new(),
    };

    let run_result = (|| -> Result<(), Box<dyn Error>> {
        let mut worker = application
            .sandbox_service
            .launch_candidate_worker(&transaction_id, budget)?;
        worker.send_command(&json!({"op": "ping"}))?;
        let response = worker
            .read_response()?
            .ok_or_else(|| invalid_config("worker closed before ping response"))?;
        if response.get("ok") != Some(&Value::Bool(true))
            || response.get("namespace_init") != Some(&Value::Bool(true))
            || response.get("pid").and_then(Value::as_i64) != Some(1)
        {
            return Err(invalid_config("worker did not confirm PID-namespace-init status").into());
        }
        eprintln!("klyn-daemon: worker smoke passed: {response}");
        let status = worker.shutdown()?;
        if !status.success() {
            return Err(invalid_config("worker exited unsuccessfully").into());
        }
        Ok(())
    })();

    let abort_result = application
        .fs_service
        .execute(Method::FsAbort, &json!({"transaction_id": transaction_id}));

    run_result?;
    abort_result?;
    Ok(())
}

fn required_absolute_path(name: &str) -> Result<PathBuf, Box<dyn Error>> {
    let path = env::var_os(name)
        .map(PathBuf::from)
        .ok_or_else(|| invalid_config(&format!("{name} is required")))?;
    if !path.is_absolute() {
        return Err(invalid_config(&format!("{name} must be an absolute path")).into());
    }
    Ok(path)
}

fn optional_u64(name: &str, default: u64) -> Result<u64, Box<dyn Error>> {
    match env::var(name) {
        Ok(value) => Ok(value
            .parse::<u64>()
            .map_err(|_| invalid_config(&format!("{name} must be an unsigned integer")))?),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(invalid_config(&format!("{name}: {error}")).into()),
    }
}

fn optional_usize(name: &str, default: usize) -> Result<usize, Box<dyn Error>> {
    match env::var(name) {
        Ok(value) => Ok(value
            .parse::<usize>()
            .map_err(|_| invalid_config(&format!("{name} must be an unsigned integer")))?),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(invalid_config(&format!("{name}: {error}")).into()),
    }
}

fn read_private_file(path: &Path, maximum_bytes: usize) -> io::Result<Vec<u8>> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "private config path must be absolute",
        ));
    }
    let before = fs::symlink_metadata(path)?;
    let uid = nix::unistd::geteuid().as_raw();
    if before.file_type().is_symlink()
        || !before.is_file()
        || before.uid() != uid
        || before.mode() & 0o077 != 0
        || before.len() > maximum_bytes as u64
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "config file must be daemon-owned, private, regular and bounded",
        ));
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let after = file.metadata()?;
    if !after.is_file()
        || after.uid() != uid
        || after.ino() != before.ino()
        || after.dev() != before.dev()
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "config file identity changed while opening",
        ));
    }
    let mut bytes = Vec::with_capacity(after.len() as usize);
    (&mut file)
        .take(maximum_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > maximum_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private config file is empty or too large",
        ));
    }
    Ok(bytes)
}

fn invalid_config(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_owned())
}
