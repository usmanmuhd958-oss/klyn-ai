//! Production entry point for the Linux KLYN IPC daemon.
//!
//! Task execution is opt-in. Without KLYN_EXECUTION_ENABLED=1, the daemon can
//! serve configured non-execution IPC operations but ExecuteTask remains
//! unavailable. When enabled, every execution setting and trusted file must
//! validate before the router is published; no partial configuration causes
//! a weaker execution path to be selected.

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, OpenOptions},
    io::Read,
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    thread,
    time::Duration,
};

use ed25519_dalek::SigningKey;
use klyn_daemon::{
    execution::{ExecutionService, ExecutionServiceConfig},
    lifecycle::Lifecycle,
    policy::{Permission, PolicyEnforcer, UidPolicy},
    server::{self, BoundSocket},
    Router,
};
use klyn_sandbox::{
    broker::{
        BrokerConfig, CapabilityVerifier, Ed25519CapabilityVerifier, ResourceBroker,
        RevocationOracle,
    },
    supervisor::validate_trusted_init_executable,
    validate_trusted_executable, validate_trusted_root, ResourceBudget,
};

const DRAIN_TIMEOUT: Duration = Duration::from_secs(15);

struct ExecutionRuntime {
    service: Arc<ExecutionService>,
    broker: ResourceBroker,
    permitted_uids: BTreeSet<u32>,
}

/// Deliberately deny all broker resource operations until a persistent,
/// auditable revocation oracle is configured. This keeps the current registered
/// JSON-only operations available while file/network capabilities remain
/// unavailable rather than silently accepting unchecked revocation status.
struct DenyAllResourceAccess;

impl RevocationOracle for DenyAllResourceAccess {
    fn is_revoked(&self, _token_id: &str) -> Result<bool, String> {
        Ok(true)
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("klyn-daemon: {error}");
        std::process::exit(78);
    }
}

fn run() -> Result<(), String> {
    let socket_path = required_path("KLYN_DAEMON_SOCKET")?;
    let daemon_uids = parse_uid_list(&required_string("KLYN_DAEMON_UIDS")?, "KLYN_DAEMON_UIDS")?;
    let mut policy = UidPolicy::new();
    for uid in &daemon_uids {
        policy.grant(*uid, Permission::ObserveDaemon);
    }

    let lifecycle = Lifecycle::new();
    let execution_runtime = build_execution_runtime()?;
    if let Some(runtime) = &execution_runtime {
        for uid in &runtime.permitted_uids {
            policy.grant(*uid, Permission::ObserveDaemon);
            policy.grant(*uid, Permission::ExecuteTask);
        }
    }

    let router = assemble_router(
        lifecycle.clone(),
        Arc::new(policy),
        execution_runtime.as_ref().map(|runtime| Arc::clone(&runtime.service)),
    );

    // Bind the daemon socket before launching auxiliary threads, so a bad
    // deployment path fails startup instead of leaving an orphan broker.
    let socket = BoundSocket::bind(&socket_path)
        .map_err(|error| format!("bind daemon socket: {error}"))?;

    if let Some(runtime) = execution_runtime {
        let broker_lifecycle = lifecycle.clone();
        thread::Builder::new()
            .name("klyn-resource-broker".into())
            .spawn(move || match runtime.broker.serve() {
                Ok(()) => {
                    eprintln!("klyn-daemon: resource broker exited unexpectedly");
                    let _ = broker_lifecycle.fail("resource broker exited unexpectedly");
                }
                Err(error) => {
                    eprintln!("klyn-daemon: resource broker failed: {error}");
                    let _ = broker_lifecycle.fail("resource broker failed");
                }
            })
            .map_err(|error| format!("start resource broker thread: {error}"))?;
    } else {
        eprintln!(
            "klyn-daemon: execution is disabled; ExecuteTask will return ExecutionUnavailable"
        );
    }

    server::serve(socket, Arc::new(router), DRAIN_TIMEOUT)
        .map_err(|error| format!("daemon server stopped: {error}"))
}

fn assemble_router(
    lifecycle: Lifecycle,
    policy: Arc<dyn PolicyEnforcer>,
    execution: Option<Arc<ExecutionService>>,
) -> Router {
    let router = Router::new(lifecycle, policy);
    match execution {
        Some(service) => router.with_execution(service),
        None => router,
    }
}

fn build_execution_runtime() -> Result<Option<ExecutionRuntime>, String> {
    if !execution_enabled(env::var("KLYN_EXECUTION_ENABLED").ok().as_deref())? {
        return Ok(None);
    }

    if !nix::unistd::Uid::effective().is_root() {
        return Err(
            "KLYN_EXECUTION_ENABLED=1 requires a root daemon on a dedicated Linux host".into(),
        );
    }

    let init_executable = required_path("KLYN_INIT_EXECUTABLE")?;
    let worker_executable = required_path("KLYN_WORKER_EXECUTABLE")?;
    let delegated_cgroup_root = required_path("KLYN_CGROUP_ROOT")?;
    let broker_socket = required_path("KLYN_BROKER_SOCKET")?;
    let workspace_root = required_path("KLYN_WORKSPACE_ROOT")?;
    let signing_key_path = required_path("KLYN_OCAP_SIGNING_KEY")?;
    let permitted_uids =
        parse_uid_list(&required_string("KLYN_EXECUTION_UIDS")?, "KLYN_EXECUTION_UIDS")?;

    let worker_uid = required_number::<u32>("KLYN_WORKER_UID")?;
    let worker_gid = required_number::<u32>("KLYN_WORKER_GID")?;
    let memory_max_bytes = required_number::<u64>("KLYN_MEMORY_MAX_BYTES")?;
    let cpu_quota_micros = required_number::<u64>("KLYN_CPU_QUOTA_MICROS")?;
    let cpu_period_micros = required_number::<u64>("KLYN_CPU_PERIOD_MICROS")?;
    let pids_max = required_number::<u32>("KLYN_PIDS_MAX")?;
    let cpu_weight = required_number::<u32>("KLYN_CPU_WEIGHT")?;
    let execution_timeout = Duration::from_secs(required_number::<u64>(
        "KLYN_EXECUTION_TIMEOUT_SECS",
    )?);
    let capability_ttl =
        Duration::from_secs(required_number::<u64>("KLYN_CAPABILITY_TTL_SECS")?);
    let worker_id_prefix = required_string("KLYN_WORKER_ID_PREFIX")?;

    let init_executable = validate_trusted_init_executable(init_executable)
        .map_err(|error| format!("trusted stage-0 validation failed: {error}"))?;
    let worker_executable = validate_trusted_executable(worker_executable)
        .map_err(|error| format!("trusted worker validation failed: {error}"))?;
    let workspace_root = validate_trusted_root(&workspace_root)
        .map_err(|error| format!("trusted workspace validation failed: {error}"))?;
    let delegated_cgroup_root = validate_delegated_cgroup_root(&delegated_cgroup_root)?;

    let signing_key = load_root_signing_key(&signing_key_path)?;
    let worker_public_key = klyn_sandbox::worker_bootstrap::load_trusted_verifying_key()
        .map_err(|error| format!("worker verification key validation failed: {error}"))?;
    let derived_public_key = signing_key.verifying_key();
    if worker_public_key.to_bytes() != derived_public_key.to_bytes() {
        return Err(
            "OCap private signing key does not match /etc/klyn/ocap-ed25519.pub".into(),
        );
    }

    let budget = ResourceBudget {
        memory_max_bytes,
        cpu_quota_micros,
        cpu_period_micros,
        pids_max,
        io_limits: vec![],
    };
    budget
        .validate()
        .map_err(|error| format!("invalid resource budget: {error}"))?;

    let roots = BTreeMap::from([("workspace".to_owned(), workspace_root)]);
    let verifier: Arc<dyn CapabilityVerifier> =
        Arc::new(Ed25519CapabilityVerifier::new(derived_public_key));
    let broker = ResourceBroker::bind(BrokerConfig {
        socket_path: broker_socket.clone(),
        roots: roots.clone(),
        verifier,
        revocations: Arc::new(DenyAllResourceAccess),
        max_workers: 4,
        queue_capacity: 64,
    })
    .map_err(|error| format!("configure resource broker: {error}"))?;

    let service = ExecutionService::new(
        ExecutionServiceConfig {
            init_executable,
            worker_executable,
            delegated_cgroup_root,
            broker_socket,
            roots,
            worker_uid,
            worker_gid,
            file_grants: vec![],
            network_grants: vec![],
            budget,
            cpu_weight,
            worker_id_prefix,
            execution_timeout,
            capability_ttl,
        },
        signing_key,
    )
    .map_err(|error| format!("configure sandbox execution service: {error}"))?;

    Ok(Some(ExecutionRuntime {
        service: Arc::new(service),
        broker,
        permitted_uids,
    }))
}

fn execution_enabled(value: Option<&str>) -> Result<bool, String> {
    match value {
        None | Some("0") | Some("false") => Ok(false),
        Some("1") | Some("true") => Ok(true),
        Some(_) => Err(
            "KLYN_EXECUTION_ENABLED must be exactly 0, 1, false, or true".into(),
        ),
    }
}

fn required_string(name: &str) -> Result<String, String> {
    let value = env::var(name).map_err(|_| format!("required environment variable {name} is missing"))?;
    if value.trim().is_empty() {
        return Err(format!("required environment variable {name} is empty"));
    }
    Ok(value)
}

fn required_path(name: &str) -> Result<PathBuf, String> {
    let value = PathBuf::from(required_string(name)?);
    if !value.is_absolute() {
        return Err(format!("{name} must be an absolute path"));
    }
    Ok(value)
}

fn required_number<T>(name: &str) -> Result<T, String>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    let value = required_string(name)?;
    value
        .parse::<T>()
        .map_err(|error| format!("{name} has an invalid value: {error}"))
}

fn parse_uid_list(value: &str, name: &str) -> Result<BTreeSet<u32>, String> {
    let mut uids = BTreeSet::new();
    for item in value.split(',') {
        let item = item.trim();
        if item.is_empty() {
            return Err(format!("{name} must be a non-empty comma-separated list of UIDs"));
        }
        let uid = item
            .parse::<u32>()
            .map_err(|error| format!("{name} contains an invalid UID '{item}': {error}"))?;
        if !uids.insert(uid) {
            return Err(format!("{name} contains duplicate UID {uid}"));
        }
    }
    if uids.is_empty() {
        return Err(format!("{name} must contain at least one UID"));
    }
    Ok(uids)
}

fn validate_delegated_cgroup_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("canonicalize cgroup root {}: {error}", path.display()))?;
    if !canonical.join("cgroup.controllers").is_file()
        || !canonical.join("cgroup.subtree_control").is_file()
        || fs::read_to_string(canonical.join("cgroup.type"))
            .map_err(|error| format!("read cgroup.type: {error}"))?
            .trim()
            != "domain"
        || !canonical.join("cgroup.kill").exists()
    {
        return Err("KLYN_CGROUP_ROOT must be a killable domain cgroup-v2 subtree".into());
    }

    let available = fs::read_to_string(canonical.join("cgroup.controllers"))
        .map_err(|error| format!("read cgroup.controllers: {error}"))?;
    let enabled = fs::read_to_string(canonical.join("cgroup.subtree_control"))
        .map_err(|error| format!("read cgroup.subtree_control: {error}"))?;
    for controller in ["cpu", "memory", "pids"] {
        if !available.split_whitespace().any(|name| name == controller) {
            return Err(format!("required cgroup controller {controller} is unavailable"));
        }
        if !enabled.split_whitespace().any(|name| name == controller) {
            return Err(format!("required cgroup controller {controller} is not enabled"));
        }
    }

    for control in ["cgroup.procs", "cgroup.kill"] {
        OpenOptions::new()
            .write(true)
            .open(canonical.join(control))
            .map_err(|error| format!("KLYN_CGROUP_ROOT control {control} is not writable: {error}"))?;
    }
    Ok(canonical)
}

fn load_root_signing_key(path: &Path) -> Result<SigningKey, String> {
    validate_root_controlled_parent_chain(path)?;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| format!("open OCap signing key: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("stat OCap signing key: {error}"))?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o077 != 0
        || metadata.mode() & (libc::S_ISUID | libc::S_ISGID) != 0
        || metadata.len() != 32
    {
        return Err(
            "OCap signing key must be a root-owned, mode-0600-or-stricter regular file of exactly 32 bytes"
                .into(),
        );
    }

    let mut bytes = [0u8; 32];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("read OCap signing key: {error}"))?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn validate_root_controlled_parent_chain(path: &Path) -> Result<(), String> {
    let mut parent = path.parent();
    while let Some(directory) = parent {
        let metadata = fs::symlink_metadata(directory)
            .map_err(|error| format!("stat signing-key directory {}: {error}", directory.display()))?;
        if !metadata.file_type().is_dir()
            || metadata.uid() != 0
            || metadata.mode() & 0o022 != 0
        {
            return Err(format!(
                "signing-key directory is not root-controlled: {}",
                directory.display()
            ));
        }
        if directory == Path::new("/") {
            break;
        }
        parent = directory.parent();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use klyn_protocol::{
        ExecuteTaskParams, Method, Request, Response, RpcErrorCode, TaskOperation,
        PROTOCOL_VERSION,
    };
    use serde_json::json;

    #[test]
    fn execution_is_disabled_by_default_and_rejects_unknown_toggle_values() {
        assert!(!execution_enabled(None).expect("missing toggle must be safe-disabled"));
        assert!(!execution_enabled(Some("0")).unwrap());
        assert!(!execution_enabled(Some("false")).unwrap());
        assert!(execution_enabled(Some("1")).unwrap());
        assert!(execution_enabled(Some("true")).unwrap());
        assert!(execution_enabled(Some("sometimes")).is_err());
    }

    #[test]
    fn uid_configuration_rejects_empty_entries_and_duplicates() {
        assert!(parse_uid_list("", "TEST_UIDS").is_err());
        assert!(parse_uid_list("1000,,1001", "TEST_UIDS").is_err());
        assert!(parse_uid_list("1000,1000", "TEST_UIDS").is_err());
        assert_eq!(
            parse_uid_list("1000, 1001", "TEST_UIDS").unwrap(),
            BTreeSet::from([1000, 1001])
        );
    }

    #[test]
    fn missing_execution_configuration_returns_execution_unavailable() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().expect("mark router ready");
        let policy = UidPolicy::from_grants([(1000, Permission::ExecuteTask)]);
        let router = assemble_router(lifecycle, Arc::new(policy), None);
        let request = Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 1,
            method: Method::ExecuteTask,
            params: json!({
                "task_id": "missing-production-config",
                "operation": "hash_json",
                "payload": {"must_not_run": true}
            }),
        };
        let response: Response = router.dispatch(
            request,
            klyn_daemon::policy::PeerIdentity {
                pid: std::process::id(),
                uid: 1000,
                gid: 1000,
            },
        );
        assert_eq!(
            response.error.expect("missing service must reject task").code,
            RpcErrorCode::ExecutionUnavailable
        );
    }
}
