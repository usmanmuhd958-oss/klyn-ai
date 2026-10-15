#![cfg(target_os = "linux")]

use std::{
    fs,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use klyn_sandbox::fs_txn::FsTransaction;

#[test]
fn forced_worker_termination_discards_workspace_artifacts() {
    let parent = tempfile::tempdir().expect("private transaction parent");
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o700))
        .expect("restrict transaction parent permissions");
    let outside = tempfile::tempdir().expect("outside sentinel parent");
    let sentinel = outside.path().join("must-survive.txt");
    fs::write(&sentinel, b"host state").expect("write host sentinel");

    let mut transaction =
        FsTransaction::create(parent.path(), "integration-forced-kill").expect("transaction");
    let workspace = transaction.workspace_path().to_path_buf();
    let workspace_arg = workspace.to_str().expect("workspace path is UTF-8");

    let mut worker = Command::new("/bin/sh")
        .arg("-c")
        .arg(
            "mkdir -p \"$1/nested\" && \
             printf 'mutated database' > \"$1/nested/session.db\" && \
             touch \"$1/ready\" && exec sleep 60",
        )
        .arg("klyn-test-worker")
        .arg(workspace_arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn test worker");

    let deadline = Instant::now() + Duration::from_secs(3);
    while !workspace.join("ready").exists() {
        assert!(
            Instant::now() < deadline,
            "worker failed to create its readiness marker"
        );
        assert!(
            worker.try_wait().expect("poll worker").is_none(),
            "worker exited before creating artifacts"
        );
        thread::sleep(Duration::from_millis(5));
    }

    worker.kill().expect("forcibly terminate worker");
    let status = worker.wait().expect("reap killed worker");
    assert!(
        !status.success(),
        "forced termination unexpectedly succeeded"
    );
    assert!(workspace.join("nested/session.db").is_file());

    transaction
        .rollback_after_cgroup_empty()
        .expect("discard transaction after worker exit");

    assert!(!workspace.exists(), "workspace survived worker termination");
    assert!(
        !transaction.transaction_root().exists(),
        "transaction root survived worker termination"
    );
    assert_eq!(
        fs::read(&sentinel).expect("read host sentinel"),
        b"host state"
    );
    assert_eq!(
        fs::read_dir(parent.path())
            .expect("read transaction parent")
            .count(),
        0
    );
}
