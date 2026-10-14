//! Privileged Linux E2E tests for the daemon -> supervisor -> worker path.
//!
//! Ordinary CI skips these host-dependent checks. The dedicated, ephemeral
//! kernel-qualification runner sets KLYN_REQUIRE_KERNEL_ISOLATION=1. In that
//! mode, missing environment variables, cgroup controls, or kernel features
//! are hard failures instead of successful skips.

use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use ed25519_dalek::{SigningKey, VerifyingKey};
use klyn_daemon::{
    execution::{ExecutionService, ExecutionServiceConfig},
    lifecycle::Lifecycle,
    policy::{PeerIdentity, Permission, UidPolicy},
    Router,
};
use klyn_protocol::{
    ExecuteTaskParams, Method, Request, RpcErrorCode, TaskOperation, PROTOCOL_VERSION,
};
use klyn_sandbox::{
    broker::{
        BrokerConfig, CapabilityVerifier, Ed25519CapabilityVerifier, ResourceBroker,
        RevocationOracle,
    },
    ResourceBudget,
};
use serde_json::json;
use tempfile::TempDir;

const AUTHORIZED_UID: u32 = 1_000;
const WORKER_UID: u32 = 65_534;
const WORKER_GID: u32 = 65_534;
static PRIVILEGED_E2E_LOCK: Mutex<()> = Mutex::new(());

struct NoRevocations;

impl RevocationOracle for NoRevocations {
    fn is_revoked(&self, _token_id: &str) -> Result<bool, String> {
        Ok(false)
    }
}

struct Harness {
    _temp: TempDir,
    router: Router,
    cgroup_root: PathBuf,
}

fn strict_kernel_e2e_enabled() -> bool {
    std::env::var_os("KLYN_REQUIRE_KERNEL_ISOLATION").is_some()
}

fn required_env(name: &str) -> PathBuf {
    match std::env::var_os(name) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => panic!(
            "KLYN_REQUIRE_KERNEL_ISOLATION is set, but required environment variable {name} is missing"
        ),
    }
}

fn request() -> Request {
    Request {
        protocol_version: PROTOCOL_VERSION,
        request_id: 1,
        method: Method::ExecuteTask,
        params: serde_json::to_value(ExecuteTaskParams {
            task_id: "privileged-e2e-hash".into(),
            operation: TaskOperation::HashJson,
            payload: json!({"phase": 2, "sandbox": "required"}),
        })
        .expect("serialize bounded task parameters"),
    }
}

fn build_harness(
    worker_env: &str,
    worker_id_prefix: &str,
    execution_timeout: Duration,
    start_broker: bool,
) -> Harness {
    assert!(strict_kernel_e2e_enabled());
    assert!(
        nix::unistd::Uid::current().is_root(),
        "privileged E2E must run as root on a dedicated ephemeral Linux VM"
    );

    let init_executable = required_env("KLYN_E2E_INIT_EXECUTABLE");
    let worker_executable = required_env(worker_env);
    let cgroup_root = required_env("KLYN_TEST_CGROUP_ROOT");

    let temp = tempfile::Builder::new()
        .prefix("klyn-privileged-e2e-")
        .tempdir_in("/tmp")
        .expect("create isolated test directory");
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).expect("create trusted workspace root");
    fs::set_permissions(&workspace, fs::Permissions::from_mode(0o700))
        .expect("restrict workspace permissions");

    // Test key material is deliberately deterministic and belongs only on
    // this isolated ephemeral VM. Never reuse it in a deployed installation.
    let signing_key = SigningKey::from_bytes(&[7; 32]);
    let key_dir = PathBuf::from("/etc/klyn");
    fs::create_dir_all(&key_dir).expect("create trusted key directory");
    fs::set_permissions(&key_dir, fs::Permissions::from_mode(0o755))
        .expect("protect trusted key directory");
    let key_path = key_dir.join("ocap-ed25519.pub");
    fs::write(&key_path, signing_key.verifying_key().to_bytes())
        .expect("provision test-only OCap public key");
    fs::set_permissions(&key_path, fs::Permissions::from_mode(0o644))
        .expect("make public verification key readable");
    let key_metadata = fs::metadata(&key_path).expect("stat verification key");
    assert_eq!(key_metadata.uid(), 0, "verification key must be root-owned");
    assert_eq!(
        key_metadata.len(),
        32,
        "verification key must be exactly 32 bytes"
    );

    let roots = BTreeMap::from([("workspace".to_owned(), workspace.clone())]);
    let socket_path = temp.path().join("broker.sock");
    if start_broker {
        let verifier: Arc<dyn CapabilityVerifier> = Arc::new(Ed25519CapabilityVerifier::new(
            VerifyingKey::from_bytes(&signing_key.verifying_key().to_bytes())
                .expect("valid test verification key"),
        ));
        let broker = ResourceBroker::bind(BrokerConfig {
            socket_path: socket_path.clone(),
            roots: roots.clone(),
            verifier,
            revocations: Arc::new(NoRevocations),
            max_workers: 2,
            queue_capacity: 8,
        })
        .expect("bind real capability-checked resource broker");
        thread::Builder::new()
            .name("klyn-e2e-broker".into())
            .spawn(move || {
                if let Err(error) = broker.serve() {
                    eprintln!("privileged E2E broker stopped: {error}");
                }
            })
            .expect("start real broker accept loop");
    }

    let service = Arc::new(
        ExecutionService::new(
            ExecutionServiceConfig {
                init_executable,
                worker_executable,
                delegated_cgroup_root: cgroup_root.clone(),
                broker_socket: socket_path,
                roots,
                worker_uid: WORKER_UID,
                worker_gid: WORKER_GID,
                file_grants: vec![],
                network_grants: vec![],
                budget: ResourceBudget {
                    memory_max_bytes: 256 * 1024 * 1024,
                    cpu_quota_micros: 100_000,
                    cpu_period_micros: 100_000,
                    pids_max: 64,
                    io_limits: vec![],
                },
                cpu_weight: 100,
                worker_id_prefix: worker_id_prefix.into(),
                execution_timeout,
                capability_ttl: execution_timeout + Duration::from_secs(30),
            },
            signing_key,
        )
        .expect("validate trusted execution configuration"),
    );

    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().expect("mark daemon ready");
    let policy = UidPolicy::from_grants([(AUTHORIZED_UID, Permission::ExecuteTask)]);
    let router = Router::new(lifecycle, Arc::new(policy)).with_execution(service);

    Harness {
        _temp: temp,
        router,
        cgroup_root,
    }
}

fn cgroups_with_prefix(root: &Path, prefix: &str) -> Vec<PathBuf> {
    fs::read_dir(root)
        .unwrap_or_else(|error| panic!("read delegated cgroup root {}: {error}", root.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&format!("{prefix}-")))
        })
        .collect()
}

fn assert_cgroup_prefix_removed(root: &Path, prefix: &str) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let remaining = cgroups_with_prefix(root, prefix);
        if remaining.is_empty() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "sandbox leaf cgroup(s) remain after execution failure: {remaining:?}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn process_start_time(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, fields_after_comm) = stat.rsplit_once(") ")?;
    // The first field after comm is field 3 (state); starttime is field 22.
    fields_after_comm.split_whitespace().nth(19)?.parse().ok()
}

fn observe_cgroup_processes(
    root: PathBuf,
    prefix: String,
    stop: Arc<AtomicBool>,
    seen: Arc<Mutex<BTreeMap<u32, u64>>>,
) {
    while !stop.load(Ordering::Acquire) {
        for cgroup in cgroups_with_prefix(&root, &prefix) {
            let Ok(members) = fs::read_to_string(cgroup.join("cgroup.procs")) else {
                continue;
            };
            for pid in members.lines().filter_map(|line| line.trim().parse::<u32>().ok()) {
                if let Some(start_time) = process_start_time(pid) {
                    seen.lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .entry(pid)
                        .or_insert(start_time);
                }
            }
        }
        thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn authorized_task_runs_via_real_supervisor_and_kernel_sandbox() {
    let _guard = PRIVILEGED_E2E_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !strict_kernel_e2e_enabled() {
        eprintln!("SKIP: set KLYN_REQUIRE_KERNEL_ISOLATION=1 on the dedicated privileged runner");
        return;
    }

    let harness = build_harness(
        "KLYN_E2E_WORKER_EXECUTABLE",
        "auth-e2e",
        Duration::from_secs(20),
        true,
    );
    let response = harness.router.dispatch(
        request(),
        PeerIdentity {
            pid: std::process::id(),
            uid: AUTHORIZED_UID,
            gid: AUTHORIZED_UID,
        },
    );

    assert!(
        response.error.is_none(),
        "authorized sandbox execution failed: {:?}",
        response.error
    );
    let result = response.result.expect("worker result must be present");
    assert_eq!(result["task_id"], "privileged-e2e-hash");
    assert_eq!(result["operation"], "hash_json");
    assert!(
        result["output"]["sha256"].as_str().is_some(),
        "registered hash operation must return a SHA-256 digest"
    );
    assert_cgroup_prefix_removed(&harness.cgroup_root, "auth-e2e");
}

#[test]
fn timeout_returns_execution_timeout_and_removes_the_entire_cgroup_leaf() {
    let _guard = PRIVILEGED_E2E_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !strict_kernel_e2e_enabled() {
        eprintln!("SKIP: set KLYN_REQUIRE_KERNEL_ISOLATION=1 on the dedicated privileged runner");
        return;
    }

    let prefix = "timeout-e2e";
    let harness = build_harness(
        "KLYN_E2E_TIMEOUT_WORKER_EXECUTABLE",
        prefix,
        Duration::from_secs(1),
        true,
    );

    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(Mutex::new(BTreeMap::<u32, u64>::new()));
    let observer = {
        let root = harness.cgroup_root.clone();
        let prefix = prefix.to_owned();
        let stop = Arc::clone(&stop);
        let seen = Arc::clone(&seen);
        thread::spawn(move || observe_cgroup_processes(root, prefix, stop, seen))
    };

    let response = harness.router.dispatch(
        request(),
        PeerIdentity {
            pid: std::process::id(),
            uid: AUTHORIZED_UID,
            gid: AUTHORIZED_UID,
        },
    );
    stop.store(true, Ordering::Release);
    observer.join().expect("join cgroup process observer");

    assert_eq!(
        response.error.expect("hung task must not return success").code,
        RpcErrorCode::ExecutionTimeout,
        "ExecutionService must map its deadline to the explicit timeout RPC error"
    );
    assert_cgroup_prefix_removed(&harness.cgroup_root, prefix);

    let observed = seen
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert!(
        !observed.is_empty(),
        "observer never saw a process inside the real worker cgroup"
    );
    for (pid, start_time) in observed {
        assert_ne!(
            process_start_time(pid),
            Some(start_time),
            "sandbox process {pid} survived timeout (or retained the same process identity)"
        );
    }
}

#[test]
fn worker_bootstrap_failure_returns_execution_failed_without_fallback() {
    let _guard = PRIVILEGED_E2E_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !strict_kernel_e2e_enabled() {
        eprintln!("SKIP: set KLYN_REQUIRE_KERNEL_ISOLATION=1 on the dedicated privileged runner");
        return;
    }

    // Deliberately withhold the resource broker. The real worker must fail
    // bootstrap before POLICY_READY, and the supervisor must kill/reap it.
    let prefix = "gate-fault-e2e";
    let harness = build_harness(
        "KLYN_E2E_WORKER_EXECUTABLE",
        prefix,
        Duration::from_secs(5),
        false,
    );
    let response = harness.router.dispatch(
        request(),
        PeerIdentity {
            pid: std::process::id(),
            uid: AUTHORIZED_UID,
            gid: AUTHORIZED_UID,
        },
    );

    assert_eq!(
        response.error.expect("missing broker must not return a result").code,
        RpcErrorCode::ExecutionFailed,
        "a failed bootstrap/policy gate must propagate as a sandbox failure"
    );
    assert_cgroup_prefix_removed(&harness.cgroup_root, prefix);
}
