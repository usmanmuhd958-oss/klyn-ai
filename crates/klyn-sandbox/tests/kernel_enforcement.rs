use std::{
    fs::{self, File},
    os::fd::AsFd,
    os::unix::fs::symlink,
    process::Command,
};

use klyn_sandbox::{
    landlock_seccomp::{apply_landlock_rules, open_scoped_directory, scope_landlock_rule, install_agent_seccomp},
    CapabilityScope,
};
use tempfile::tempdir;

#[test]
fn landlock_probe_child() {
    if std::env::var_os("KLYN_LANDLOCK_PROBE").is_none() {
        return;
    }
    let root_path = std::env::var("KLYN_LANDLOCK_ROOT").unwrap();
    let allowed_path = std::env::var("KLYN_LANDLOCK_ALLOWED").unwrap();
    let denied_path = std::env::var("KLYN_LANDLOCK_DENIED").unwrap();

    let root = File::open(root_path).unwrap();
    let scope = CapabilityScope::Filesystem {
        handle_id: "fs-handle-1".into(),
        resource_id: "workspace-1".into(),
        operations: vec!["fs.read".into(), "fs.list".into()],
        relative_path_prefix: "allowed".into(),
        max_bytes_per_invocation: 4096,
    };
    let (subtree_fd, rule) = scope_landlock_rule(root.as_fd(), &scope).unwrap();
    apply_landlock_rules(&[rule]).unwrap();

    // Drop all setup descriptors before simulating the untrusted worker.
    drop(subtree_fd);
    drop(root);
    assert!(File::open(allowed_path).is_ok(), "granted subtree must remain readable");
    assert!(File::open(denied_path).is_err(), "out-of-scope file access must be denied by Landlock");
}

#[test]
fn landlock_rejects_out_of_scope_filesystem_access_in_a_child_process() {
    if klyn_sandbox::landlock_seccomp::query_landlock_abi().is_err() {
        // A missing/disabled Landlock ABI is a launch-time hard denial; this kernel-level
        // assertion can only execute on runners with Landlock enabled.
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

    let output = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("landlock_probe_child")
        .arg("--nocapture")
        .env("KLYN_LANDLOCK_PROBE", "1")
        .env("KLYN_LANDLOCK_ROOT", temp.path())
        .env("KLYN_LANDLOCK_ALLOWED", &allowed)
        .env("KLYN_LANDLOCK_DENIED", &denied)
        .output()
        .unwrap();
    assert!(output.status.success(), "Landlock child failed: {}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn seccomp_probe_child() {
    if std::env::var_os("KLYN_SECCOMP_PROBE").is_none() {
        return;
    }
    install_agent_seccomp().unwrap();

    let network_fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    assert_eq!(network_fd, -1, "sandboxed worker must not create direct network sockets");
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(libc::EPERM));

    let open_attempt = File::open("/etc/passwd");
    assert!(open_attempt.is_err(), "sandboxed worker must not open filesystem paths directly");
    assert_eq!(open_attempt.unwrap_err().raw_os_error(), Some(libc::EPERM));
}

#[test]
fn seccomp_blocks_unbrokered_socket_and_path_open_in_a_child_process() {
    let output = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("seccomp_probe_child")
        .arg("--nocapture")
        .env("KLYN_SECCOMP_PROBE", "1")
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
