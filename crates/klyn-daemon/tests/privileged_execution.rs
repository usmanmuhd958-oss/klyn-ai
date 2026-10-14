//! Privileged end-to-end test for the actual daemon -> supervisor -> worker path.
//!
//! Normal CI deliberately skips this test. The dedicated kernel-qualification
//! runner sets KLYN_REQUIRE_KERNEL_ISOLATION=1 and must provide the trusted
//! installed executables plus a writable delegated cgroup-v2 subtree. In that
//! mode missing prerequisites are hard failures, never successful skips.

use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::PathBuf,
    sync::Arc,
    thread,
    time::Duration,
};

use ed25519_dalek::{SigningKey, VerifyingKey};
use klyn_daemon::{
    execution::{ExecutionService, ExecutionServiceConfig},
    lifecycle::Lifecycle,
    policy::{PeerIdentity, Permission, UidPolicy},
    Router,
};
use klyn_protocol::{
    ExecuteTaskParams, Method, Request, TaskOperation, PROTOCOL_VERSION,
};
use klyn_sandbox::{
    broker::{
        BrokerConfig, CapabilityVerifier, Ed25519CapabilityVerifier, ResourceBroker,
        RevocationOracle,
    },
    ResourceBudget,
};
use serde_json::json;

struct NoRevocations;

impl RevocationOracle for NoRevocations {
    fn is_revoked(&self, _token_id: &str) -> Result<bool, String> {
        Ok(false)
    }
}

fn required_env(name: &str) -> PathBuf {
    match std::env::var_os(name) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => panic!(
            "KLYN_REQUIRE_KERNEL_ISOLATION is set, but required environment variable {name} is missing"
        ),
    }
}

#[test]
fn authorized_task_runs_via_real_supervisor_and_kernel_sandbox() {
    if std::env::var_os("KLYN_REQUIRE_KERNEL_ISOLATION").is_none() {
        eprintln!(
            "SKIP: privileged daemon-to-supervisor E2E requires KLYN_REQUIRE_KERNEL_ISOLATION=1"
        );
        return;
    }

    assert!(
        nix::unistd::Uid::current().is_root(),
        "privileged E2E must run as root on a dedicated ephemeral Linux VM"
    );

    let init_executable = required_env("KLYN_E2E_INIT_EXECUTABLE");
    let worker_executable = required_env("KLYN_E2E_WORKER_EXECUTABLE");
    let delegated_cgroup_root = required_env("KLYN_TEST_CGROUP_ROOT");

    let temp = tempfile::Builder::new()
        .prefix("klyn-privileged-e2e-")
        .tempdir_in("/tmp")
        .expect("create isolated test directory");
    let workspace = temp.path().join("workspace");
    fs::create_dir(&workspace).expect("create trusted workspace root");
    fs::set_permissions(&workspace, fs::Permissions::from_mode(0o700))
        .expect("restrict workspace permissions");

    // The launcher/worker trust the public key provisioned by the image
    // manager. This deterministic key is test-only and must never be reused in
    // a deployed KLYN installation. The runner is required to be ephemeral.
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
    assert_eq!(key_metadata.len(), 32, "verification key must be exactly 32 bytes");

    let roots = BTreeMap::from([("workspace".to_owned(), workspace.clone())]);
    let socket_path = temp.path().join("broker.sock");
    let verifier: Arc<dyn CapabilityVerifier> =
        Arc::new(Ed25519CapabilityVerifier::new(VerifyingKey::from_bytes(
            &signing_key.verifying_key().to_bytes(),
        ).expect("valid test verification key")));
    let broker = ResourceBroker::bind(BrokerConfig {
        socket_path: socket_path.clone(),
        roots: roots.clone(),
        verifier,
        revocations: Arc::new(NoRevocations),
        max_workers: 2,
        queue_capacity: 8,
    })
    .expect("bind real capability-checked resource broker");
    let _broker_thread = thread::Builder::new()
        .name("klyn-e2e-broker".into())
        .spawn(move || {
            if let Err(error) = broker.serve() {
                eprintln!("privileged E2E broker stopped: {error}");
            }
        })
        .expect("start real broker accept loop");

    let service = Arc::new(
        ExecutionService::new(
            ExecutionServiceConfig {
                init_executable,
                worker_executable,
                delegated_cgroup_root,
                broker_socket: socket_path,
                roots,
                worker_uid: 65_534,
                worker_gid: 65_534,
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
                worker_id_prefix: "e2e".into(),
                execution_timeout: Duration::from_secs(20),
                capability_ttl: Duration::from_secs(90),
            },
            signing_key,
        )
        .expect("validate trusted execution configuration"),
    );

    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().expect("mark daemon ready");
    let authorized_uid = 1_000;
    let policy = UidPolicy::from_grants([(authorized_uid, Permission::ExecuteTask)]);
    let router = Router::new(lifecycle, Arc::new(policy)).with_execution(service);

    let request = Request {
        protocol_version: PROTOCOL_VERSION,
        request_id: 1,
        method: Method::ExecuteTask,
        params: serde_json::to_value(ExecuteTaskParams {
            task_id: "privileged-e2e-hash".into(),
            operation: TaskOperation::HashJson,
            payload: json!({"phase": 2, "sandbox": "required"}),
        })
        .expect("serialize bounded task parameters"),
    };
    let response = router.dispatch(
        request,
        PeerIdentity {
            pid: std::process::id(),
            uid: authorized_uid,
            gid: authorized_uid,
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
}
