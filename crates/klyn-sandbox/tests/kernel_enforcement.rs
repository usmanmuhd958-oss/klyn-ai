#![cfg(target_os = "linux")]

use std::{
    collections::BTreeMap,
    ffi::CString,
    os::fd::RawFd,
    process::Command,
};

use klyn_sandbox::{
    landlock_seccomp::{apply_landlock, apply_worker_seccomp},
    CapabilityClaims, ResourceBudget, BROKER_FD, OCAP_VERSION,
};

fn probe_claims() -> CapabilityClaims {
    let uid = unsafe { libc::geteuid() } as u32;
    CapabilityClaims {
        version: OCAP_VERSION,
        token_id: "kernel-probe".into(),
        subject_uid: if uid == 0 { 1000 } else { uid },
        subject_gid: unsafe { libc::getegid() } as u32,
        expires_at_unix: u64::MAX,
        file_grants: vec![],
        network_grants: vec![],
        budget: ResourceBudget {
            memory_max_bytes: 16 * 1024 * 1024,
            cpu_quota_micros: 100_000,
            cpu_period_micros: 100_000,
            pids_max: 4,
            io_limits: vec![],
        },
    }
}

fn ensure_broker_fd_three() -> Result<RawFd, i32> {
    let mut pair = [-1; 2];
    if unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0, pair.as_mut_ptr()) } != 0 {
        return Err(10);
    }
    if pair[0] != BROKER_FD {
        if unsafe { libc::dup2(pair[0], BROKER_FD) } < 0 {
            return Err(11);
        }
        unsafe { libc::close(pair[0]); }
    }
    // Keep the other endpoint open so the broker FD is a valid connected socket.
    Ok(pair[1])
}

fn raw_exit(code: i32) -> ! {
    unsafe { libc::_exit(code) }
}

/// Child-process entry point. When invoked with the probe environment variable,
/// this test installs actual kernel restrictions and exits without returning to
/// the Rust test harness (which itself needs a broader syscall set).
#[test]
fn child_kernel_probe() {
    if std::env::var_os("KLYN_SANDBOX_KERNEL_PROBE").is_none() {
        return;
    }
    let result = unsafe { run_kernel_probe() };
    raw_exit(result);
}

unsafe fn run_kernel_probe() -> i32 {
    let peer_fd = match ensure_broker_fd_three() {
        Ok(fd) => fd,
        Err(code) => return code,
    };

    let claims = probe_claims();
    if apply_landlock(&claims, &BTreeMap::new()).is_err() {
        return 20;
    }

    // With no grants, Landlock must reject this path before seccomp is installed.
    let outside = match CString::new("/etc/passwd") {
        Ok(p) => p,
        Err(_) => return 21,
    };
    let fd = libc::open(outside.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC);
    if fd >= 0 {
        libc::close(fd);
        return 22;
    }
    let landlock_errno = *libc::__errno_location();
    if landlock_errno != libc::EACCES && landlock_errno != libc::EPERM {
        return 23;
    }

    // Pre-create a socket before seccomp, then prove connect is denied by the
    // kernel policy. No packet should be emitted, even to a loopback endpoint.
    let net_fd = libc::socket(libc::AF_INET, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0);
    if net_fd < 0 {
        return 30;
    }

    if apply_worker_seccomp(BROKER_FD).is_err() {
        return 31;
    }

    // The only permitted recvmsg target is the pre-established broker FD 3.
    let recv_rc = libc::recvmsg(peer_fd, std::ptr::null_mut(), libc::MSG_DONTWAIT);
    if recv_rc != -1 || *libc::__errno_location() != libc::EPERM {
        return 32;
    }

    let mut address: libc::sockaddr_in = std::mem::zeroed();
    address.sin_family = libc::AF_INET as libc::sa_family_t;
    address.sin_port = 9u16.to_be();
    address.sin_addr = libc::in_addr { s_addr: u32::from_ne_bytes([127, 0, 0, 1]) };
    let connect_rc = libc::connect(
        net_fd,
        (&address as *const libc::sockaddr_in).cast(),
        std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
    );
    if connect_rc != -1 || *libc::__errno_location() != libc::EPERM {
        return 33;
    }

    // A worker cannot create a new socket outside the broker.
    let socket_rc = libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0);
    if socket_rc != -1 || *libc::__errno_location() != libc::EPERM {
        return 34;
    }

    // Process execution is unavailable after the worker filter is active.
    let shell = match CString::new("/bin/sh") {
        Ok(value) => value,
        Err(_) => return 40,
    };
    let arg0 = shell.as_ptr();
    let arg1 = match CString::new("-c") {
        Ok(value) => value,
        Err(_) => return 41,
    };
    let arg2 = match CString::new("exit 73") {
        Ok(value) => value,
        Err(_) => return 42,
    };
    let mut argv = [arg0, arg1.as_ptr(), arg2.as_ptr(), std::ptr::null()];
    let envp = [std::ptr::null::<libc::c_char>()];
    let exec_rc = libc::syscall(
        libc::SYS_execve,
        shell.as_ptr(),
        argv.as_mut_ptr(),
        envp.as_ptr(),
    );
    if exec_rc != -1 || *libc::__errno_location() != libc::EPERM {
        return 43;
    }

    libc::close(net_fd);
    libc::close(peer_fd);
    0
}

#[test]
fn actual_kernel_policy_denies_out_of_scope_fs_network_and_exec() {
    let exe = std::env::current_exe().expect("current test executable");
    let output = Command::new(exe)
        .arg("--exact")
        .arg("child_kernel_probe")
        .arg("--nocapture")
        .env("KLYN_SANDBOX_KERNEL_PROBE", "1")
        .output()
        .expect("spawn isolated kernel probe");
    assert!(
        output.status.success(),
        "kernel probe failed with {:?}; stdout={}; stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
