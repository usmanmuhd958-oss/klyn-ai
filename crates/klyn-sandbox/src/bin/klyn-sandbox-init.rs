//! Trusted stage-0 namespace helper.
//!
//! This executable is launched by the privileged KLYN daemon and must be
//! root-owned and non-writable by group/other. It accepts only a fixed numeric
//! gate FD and manifest FD, waits until the daemon has attached its cgroup,
//! creates the requested namespaces, drops to the capability subject, then
//! execs the daemon-validated native worker. It never invokes a shell.

use std::{
    ffi::{CString, OsString},
    io::Read,
    os::fd::FromRawFd,
    os::unix::{fs::MetadataExt, process::CommandExt},
    path::PathBuf,
    process::Command,
};

use klyn_sandbox::validate_trusted_executable;

const GATE_FD: i32 = 5;
const MANIFEST_FD: i32 = 4;
const GATE_RELEASE: u8 = 0xA5;

fn main() {
    if let Err(error) = run() {
        eprintln!("klyn-sandbox-init: {error}");
        std::process::exit(125);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let mut uid: Option<u32> = None;
    let mut gid: Option<u32> = None;
    let mut command: Vec<OsString> = Vec::new();

    while let Some(arg) = args.next() {
        if arg == "--" {
            command.extend(args);
            break;
        }
        match arg.to_str() {
            Some("--uid") => {
                uid = Some(
                    args.next()
                        .ok_or("missing uid")?
                        .to_str()
                        .ok_or("uid is not UTF-8")?
                        .parse()
                        .map_err(|_| "invalid uid")?,
                );
            }
            Some("--gid") => {
                gid = Some(
                    args.next()
                        .ok_or("missing gid")?
                        .to_str()
                        .ok_or("gid is not UTF-8")?
                        .parse()
                        .map_err(|_| "invalid gid")?,
                );
            }
            _ => return Err("unknown argument".into()),
        }
    }

    let uid = uid.ok_or("missing uid")?;
    let gid = gid.ok_or("missing gid")?;
    if uid == 0 || command.is_empty() {
        return Err("UID 0 and empty worker command are forbidden".into());
    }

    // This privileged helper must never become a generic command runner. The
    // executable must be an absolute, daemon-controlled regular file whose
    // parent directory chain cannot be replaced by an untrusted principal.
    let requested_executable = PathBuf::from(&command[0]);
    if !requested_executable.is_absolute() {
        return Err("worker executable path must be absolute".into());
    }
    let trusted_executable = validate_trusted_executable(&requested_executable)
        .map_err(|error| format!("refusing untrusted worker executable: {error}"))?;
    command[0] = trusted_executable.into_os_string();
    validate_standard_streams()?;

    if unsafe { libc::fcntl(MANIFEST_FD, libc::F_GETFD) } < 0 {
        return Err("sealed manifest FD 4 is not inherited".into());
    }

    let mut gate = unsafe { std::fs::File::from_raw_fd(GATE_FD) };
    let mut signal = [0u8; 1];
    gate.read_exact(&mut signal)
        .map_err(|e| format!("waiting on cgroup start gate: {e}"))?;
    if signal[0] != GATE_RELEASE {
        return Err("invalid start gate signal".into());
    }
    drop(gate);

    // No namespace fallback is allowed. In particular, missing privileges or
    // namespaces must terminate launch instead of continuing without isolation.
    let namespace_flags = libc::CLONE_NEWNS
        | libc::CLONE_NEWNET
        | libc::CLONE_NEWIPC
        | libc::CLONE_NEWUTS
        | libc::CLONE_NEWPID;
    if unsafe { libc::unshare(namespace_flags) } != 0 {
        return Err(format!(
            "unshare namespaces failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let slash = CString::new("/").unwrap();
    if unsafe {
        libc::mount(
            std::ptr::null(),
            slash.as_ptr(),
            std::ptr::null(),
            (libc::MS_REC | libc::MS_PRIVATE) as libc::c_ulong,
            std::ptr::null(),
        )
    } != 0
    {
        return Err(format!(
            "making mounts private failed: {}",
            std::io::Error::last_os_error()
        ));
    }

    // unshare(CLONE_NEWPID) takes effect for children; this trusted helper stays
    // outside that PID namespace while its child becomes PID 1 inside it.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(format!(
            "fork for PID namespace failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    if pid > 0 {
        unsafe {
            libc::close(MANIFEST_FD);
        }
        let mut status: libc::c_int = 0;
        loop {
            let result = unsafe { libc::waitpid(pid, &mut status, 0) };
            if result == pid {
                break;
            }
            if result < 0
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
            {
                continue;
            }
            return Err(format!(
                "waitpid failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        if libc::WIFEXITED(status) {
            std::process::exit(libc::WEXITSTATUS(status));
        }
        if libc::WIFSIGNALED(status) {
            std::process::exit(128 + libc::WTERMSIG(status));
        }
        std::process::exit(125);
    }

    // Child branch: a minimal PID-namespace init, no shell, no inherited
    // supplemental groups or capabilities, and no privilege regain after exec.
    if unsafe {
        libc::mount(
            CString::new("proc").unwrap().as_ptr(),
            CString::new("/proc").unwrap().as_ptr(),
            CString::new("proc").unwrap().as_ptr(),
            (libc::MS_NOSUID | libc::MS_NODEV | libc::MS_NOEXEC) as libc::c_ulong,
            std::ptr::null(),
        )
    } != 0
    {
        child_fail("mounting isolated procfs failed");
    }
    if unsafe { libc::setgroups(0, std::ptr::null()) } != 0 {
        child_fail("clearing supplementary groups failed");
    }
    if unsafe { libc::setresgid(gid, gid, gid) } != 0 {
        child_fail("setresgid failed");
    }
    if unsafe { libc::setresuid(uid, uid, uid) } != 0 {
        child_fail("setresuid failed");
    }
    unsafe {
        libc::umask(0o077);
    }
    if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
        child_fail("PR_SET_DUMPABLE failed");
    }
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        child_fail("PR_SET_NO_NEW_PRIVS failed");
    }

    let executable = command.remove(0);
    let mut process = Command::new(executable);
    process.args(command);
    process.env_clear();
    process.env("PATH", "/usr/bin:/bin");
    process.env("LANG", "C");
    let error = unsafe {
        process.pre_exec(|| {
            // Preserve only the sealed manifest FD 4 plus standard streams.
            // close_range avoids silently leaking descriptors >= 1024. No
            // fallback is allowed: an old kernel must fail closed.
            let low = libc::syscall(libc::SYS_close_range, 3u32, 3u32, 0u32);
            if low != 0 {
                return Err(std::io::Error::last_os_error());
            }
            let high = libc::syscall(
                libc::SYS_close_range,
                (MANIFEST_FD + 1) as u32,
                u32::MAX,
                0u32,
            );
            if high != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        })
    }
    .exec();
    child_fail(&format!("exec trusted worker failed: {error}"));
}

fn validate_standard_streams() -> Result<(), String> {
    let null_device = std::fs::metadata("/dev/null")
        .map_err(|error| format!("cannot validate /dev/null: {error}"))?
        .rdev();

    for fd in 0..=2 {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
        if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
            return Err(format!(
                "standard descriptor {fd} is not open: {}",
                std::io::Error::last_os_error()
            ));
        }
        let stat = unsafe { stat.assume_init() };
        let kind = stat.st_mode & libc::S_IFMT;
        let safe_pipe_or_socket = kind == libc::S_IFIFO || kind == libc::S_IFSOCK;
        let safe_null_device = kind == libc::S_IFCHR && stat.st_rdev == null_device;
        if !safe_pipe_or_socket && !safe_null_device {
            return Err(format!(
                "standard descriptor {fd} must be a pipe/socket or /dev/null, not an inherited file or device"
            ));
        }
    }
    Ok(())
}

fn child_fail(message: &str) -> ! {
    let bytes = format!("klyn-sandbox-init: {message}\n");
    unsafe {
        let _ = libc::write(libc::STDERR_FILENO, bytes.as_ptr().cast(), bytes.len());
        libc::_exit(125);
    }
}
