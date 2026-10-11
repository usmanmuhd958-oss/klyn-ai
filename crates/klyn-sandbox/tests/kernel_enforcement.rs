use std::{
    fs::{self, File},
    os::fd::AsFd,
    os::unix::fs::symlink,
    process::Command,
};

use klyn_sandbox::landlock_seccomp::{open_scoped_directory, query_landlock_abi};
use tempfile::tempdir;

#[test]
fn landlock_rejects_out_of_scope_filesystem_access_in_a_single_threaded_worker() {
    if query_landlock_abi().is_err() {
        // Missing or disabled Landlock is a launch-time hard denial; skip the positive
        // kernel demonstration only when the test host does not expose Landlock.
        return;
    }
    let temp = tempdir().unwrap();
    let allowed_dir = temp.path().join("allowed");
    let denied_dir = temp.path().join("denied");
    fs::create_dir(&allowed_dir).unwrap();
    fs::create_dir(&denied_dir).unwrap();
    let allowed = allowed_dir.join("read.txt");
    let denied = denied_dir.join("secret.txt");
    fs::write(&allowed, b"permitted").unwrap();
    fs::write(&denied, b"forbidden").unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_klyn-sandbox-probe"))
        .arg("landlock")
        .env("KLYN_LANDLOCK_ROOT", temp.path())
        .env("KLYN_LANDLOCK_ALLOWED", &allowed)
        .env("KLYN_LANDLOCK_DENIED", &denied)
        .output()
        .unwrap();
    assert!(output.status.success(), "Landlock child failed: {}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn seccomp_blocks_unbrokered_socket_and_path_open_in_a_single_threaded_worker() {
    let output = Command::new(env!("CARGO_BIN_EXE_klyn-sandbox-probe"))
        .arg("seccomp")
        .output()
        .unwrap();
    assert!(output.status.success(), "seccomp child failed: {}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn openat2_rejects_symlink_escape_out_of_registered_subtree() {
    let temp = tempdir().unwrap();
    let allowed = temp.path().join("allowed");
    let outside = temp.path().join("outside");
    fs::create_dir(&allowed).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.txt"), b"secret").unwrap();
    symlink(&outside, allowed.join("escape")).unwrap();

    let root = File::open(temp.path()).unwrap();
    assert!(open_scoped_directory(root.as_fd(), "allowed/escape").is_err());
}
