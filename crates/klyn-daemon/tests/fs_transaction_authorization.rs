use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use klyn_daemon::{
    fs_service::FsService,
    lifecycle::Lifecycle,
    policy::{Permission, PeerIdentity, UidPolicy},
    Router,
};
use klyn_fs::{FsEngine, DEFAULT_PUBLICATION_REF};
use klyn_protocol::{Method, Request, Response, RpcErrorCode, PROTOCOL_VERSION};
use serde_json::{json, Value};

const OWNER_UID: u32 = 12_001;
const OTHER_UID: u32 = 12_002;
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn git(repository: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("start git");

    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn dispatch(router: &Router, uid: u32, method: Method, params: Value) -> Response {
    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    router.dispatch(
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            method,
            params,
        },
        PeerIdentity {
            pid: 1234,
            uid,
            gid: uid,
        },
    )
}

#[test]
fn transaction_mutations_are_isolated_by_authenticated_peer_uid() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "klyn-fs-peer-auth-{}-{nonce:x}",
        std::process::id()
    ));
    let repository = root.join("repo");
    let state = root.join("state");
    fs::create_dir_all(&repository).expect("create test repository");
    let _cleanup = Cleanup(root.clone());

    git(&repository, &["init", "--initial-branch=main"]);
    git(&repository, &["config", "user.name", "KLYN Transaction Test"]);
    git(
        &repository,
        &["config", "user.email", "klyn-transaction-test@invalid"],
    );
    fs::write(repository.join("README.md"), "base revision\n").expect("write initial file");
    git(&repository, &["add", "README.md"]);
    git(&repository, &["commit", "-m", "initial fixture commit"]);

    let engine =
        FsEngine::open(&repository, &state, DEFAULT_PUBLICATION_REF).expect("open fs engine");
    let filesystem = Arc::new(FsService::new(engine));
    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().unwrap();

    // Both identities are granted the methods under test so the test reaches
    // the transaction-owner guard rather than stopping at method authorization.
    let mut policy = UidPolicy::new();
    policy.grant(OWNER_UID, Permission::FsBeginCandidate);
    for uid in [OWNER_UID, OTHER_UID] {
        policy.grant(uid, Permission::FsMutateCandidate);
        policy.grant(uid, Permission::FsValidateCandidate);
        policy.grant(uid, Permission::FsPublishRevision);
        policy.grant(uid, Permission::FsAbortCandidate);
    }

    let router = Router::with_fs(lifecycle, Arc::new(policy), filesystem);
    let begin = dispatch(&router, OWNER_UID, Method::FsBegin, json!({}));
    assert!(begin.error.is_none(), "owner could not begin transaction");
    let transaction_id = begin
        .result
        .expect("begin result")
        .get("transaction_id")
        .and_then(Value::as_str)
        .expect("transaction ID string")
        .to_owned();

    let foreign_attempts = [
        (
            Method::FsWriteFile,
            json!({
                "transaction_id": transaction_id,
                "path": "owned.txt",
                "expected_old_content": null,
                "content": "unauthorized content\n"
            }),
        ),
        (Method::FsStage, json!({"transaction_id": transaction_id})),
        (Method::FsValidate, json!({"transaction_id": transaction_id})),
        (Method::FsCommit, json!({"transaction_id": transaction_id})),
        (Method::FsAbort, json!({"transaction_id": transaction_id})),
    ];

    for (method, params) in foreign_attempts {
        let response = dispatch(&router, OTHER_UID, method, params);
        assert_eq!(
            response.error.map(|error| error.code),
            Some(RpcErrorCode::Unauthorized),
            "cross-UID operation {method:?} must be denied without exposing transaction existence"
        );
    }

    // The foreign attempts must not mutate or remove the transaction. Its owner
    // can still complete a normal publication through the same registry entry.
    for (method, params) in [
        (
            Method::FsWriteFile,
            json!({
                "transaction_id": transaction_id,
                "path": "owned.txt",
                "expected_old_content": null,
                "content": "owner content\n"
            }),
        ),
        (Method::FsStage, json!({"transaction_id": transaction_id})),
        (Method::FsValidate, json!({"transaction_id": transaction_id})),
        (Method::FsCommit, json!({"transaction_id": transaction_id})),
    ] {
        let response = dispatch(&router, OWNER_UID, method, params);
        assert!(
            response.error.is_none(),
            "owner operation {method:?} failed: {:?}",
            response.error.map(|error| error.message)
        );
    }
}
