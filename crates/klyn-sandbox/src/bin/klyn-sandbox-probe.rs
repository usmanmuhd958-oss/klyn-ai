use std::{env, fs::File, os::fd::AsFd};

use klyn_sandbox::{
    landlock_seccomp::{apply_landlock_rules, scope_landlock_rule, install_agent_seccomp},
    CapabilityScope,
};

fn main() {
    let mut args = env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    let result = match mode.as_str() {
        "landlock" => run_landlock(),
        "seccomp" => run_seccomp(),
        _ => Err("probe mode must be landlock or seccomp".to_owned()),
    };
    if let Err(message) = result {
        eprintln!("sandbox probe failed: {message}");
        std::process::exit(2);
    }
}

fn run_landlock() -> Result<(), String> {
    let root_path = env::var("KLYN_LANDLOCK_ROOT").map_err(|e| e.to_string())?;
    let allowed_path = env::var("KLYN_LANDLOCK_ALLOWED").map_err(|e| e.to_string())?;
    let denied_path = env::var("KLYN_LANDLOCK_DENIED").map_err(|e| e.to_string())?;
    let root = File::open(root_path).map_err(|e| e.to_string())?;
    let scope = CapabilityScope::Filesystem {
        handle_id: "fs-handle-1".into(),
        resource_id: "workspace-1".into(),
        operations: vec!["fs.read".into(), "fs.list".into()],
        relative_path_prefix: "allowed".into(),
        max_bytes_per_invocation: 4096,
    };
    let (subtree_fd, rule) = scope_landlock_rule(root.as_fd(), &scope).map_err(|e| e.to_string())?;
    apply_landlock_rules(&[rule]).map_err(|e| e.to_string())?;
    drop(subtree_fd);
    drop(root);

    match File::open(allowed_path) {
        Ok(_) => {}
        Err(error) => return Err(format!("granted subtree unexpectedly blocked: {error}")),
    }
    match File::open(denied_path) {
        Ok(_) => return Err("out-of-scope path was readable".into()),
        Err(_) => {}
    }
    Ok(())
}

fn run_seccomp() -> Result<(), String> {
    install_agent_seccomp().map_err(|e| e.to_string())?;

    let network_fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    if network_fd != -1 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EPERM) {
        return Err("raw socket creation was not denied with EPERM".into());
    }
    match File::open("/etc/passwd") {
        Err(error) if error.raw_os_error() == Some(libc::EPERM) => {}
        Err(error) => return Err(format!("direct path open failed for an unexpected reason: {error}")),
        Ok(_) => return Err("direct path open was permitted".into()),
    }
    Ok(())
}
