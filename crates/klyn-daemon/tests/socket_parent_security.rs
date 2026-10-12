use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use klyn_daemon::server::{BoundSocket, DaemonError};
use nix::unistd::{chown, Gid, Uid};

struct Cleanup(PathBuf);

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn rejects_foreign_owned_socket_parent_even_when_mode_is_0755() {
    // The test's full ownership scenario requires chown(2). CI runs this
    // integration target under sudo; ordinary local cargo test remains usable.
    if !Uid::effective().is_root() {
        eprintln!("skipping ownership mutation: rerun as root to exercise foreign-owner integration case");
        return;
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "klyn-socket-owner-test-{}-{nonce:x}",
        std::process::id()
    ));
    fs::create_dir(&root).expect("create test root");
    let _cleanup = Cleanup(root.clone());
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("secure test root");

    let attacker_directory = root.join("attacker-owned");
    fs::create_dir(&attacker_directory).expect("create attacker directory");
    fs::set_permissions(&attacker_directory, fs::Permissions::from_mode(0o755))
        .expect("set requested mode 0755");
    chown(
        &attacker_directory,
        Some(Uid::from_raw(65_534)),
        Some(Gid::from_raw(65_534)),
    )
    .expect("assign directory to a different numeric UID");

    let metadata = fs::metadata(&attacker_directory).expect("read attacker directory metadata");
    assert_eq!(metadata.uid(), 65_534);
    assert_eq!(metadata.mode() & 0o777, 0o755);
    assert_ne!(metadata.uid(), Uid::effective().as_raw());

    let result = BoundSocket::bind(attacker_directory.join("klyn.sock"));
    assert!(
        matches!(result, Err(DaemonError::InsecureSocketDirectory)),
        "foreign-owned 0755 socket parent must be rejected before bind; got {result:?}"
    );
}
