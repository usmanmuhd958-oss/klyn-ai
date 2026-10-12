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
    time::{SystemTime, UNIX_EPOCH},
};

use klyn_sandbox::{
    broker::{CapabilityVerifier, Ed25519CapabilityVerifier},
    cgroup::CgroupV2Boundary,
    manifest::read_sealed_manifest_fd,
    validate_trusted_executable,
    worker_bootstrap::{load_trusted_verifying_key, validate_manifest_shape},
    MANIFEST_FD,
};

const GATE_FD: i32 = klyn_sandbox::start_gate::START_GATE_FD;
const GATE_RELEASE: u8 = klyn_sandbox::start_gate::START_GATE_RELEASE;

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
    if uid == 0 || command.len() != 1 {
        return Err(
            "UID 0 and any command other than one trusted worker executable are forbidden".into(),
        );
    }

    // This privileged helper must never become a generic command runner. The
    // executable must be an absolute, daemon-controlled regular file whose
    // parent directory chain cannot be replaced by an untrusted principal.
    let requested_executable = PathBuf::from(&command[0]);
    if !requested_executable.is_absolute() {
        return Err("worker executable path must be absolute".into());
    }
    if unsafe { libc::fcntl(MANIFEST_FD, libc::F_GETFD) } < 0 {
        return Err("sealed manifest FD 4 is not inherited".into());
    }

    if unsafe { libc::fcntl(GATE_FD, libc::F_GETFD) } < 0 {
        return Err("start gate FD 5 is not inherited".into());
    }

    let mut gate = unsafe { std::fs::File::from_raw_fd(GATE_FD) };
    let mut signal = [0u8; 1];
    gate.read_exact(&mut signal)
        .map_err(|e| format!("waiting on cgroup start gate: {e}"))?;
    if signal[0] != GATE_RELEASE {
        return Err("invalid start gate signal".into());
    }
    drop(gate);

    let trusted_executable = validate_trusted_executable(&requested_executable)
        .map_err(|error| format!("refusing untrusted worker executable: {error}"))?;
    command[0] = trusted_executable.clone().into_os_string();
    validate_standard_streams()?;

    // Validate the sealed manifest, signer, capability, and exact worker image
    // while still in trusted stage-0. This does not apply Landlock or seccomp;
    // those restrictions remain the worker bootstrap's responsibility after ACK.
    let duplicate = unsafe { libc::fcntl(MANIFEST_FD, libc::F_DUPFD_CLOEXEC, 10) };
    if duplicate < 0 {
        return Err(format!(
            "cannot duplicate sealed manifest FD: {}",
            std::io::Error::last_os_error()
        ));
    }
    let manifest = read_sealed_manifest_fd(duplicate)
        .map_err(|error| format!("sealed worker manifest rejected: {error}"))?;
    let verification_key = load_trusted_verifying_key()
        .map_err(|error| format!("trusted verification key rejected: {error}"))?;
    manifest
        .verify_signature(&verification_key)
        .map_err(|error| format!("manifest signature rejected: {error}"))?;
    validate_manifest_shape(&manifest)
        .map_err(|error| format!("manifest policy rejected: {error}"))?;
    manifest
        .verify_worker_executable(&trusted_executable)
        .map_err(|error| format!("worker binary identity rejected: {error}"))?;

    let claims = &manifest.capability.claims;
    if claims.subject_uid != uid || claims.subject_gid != gid {
        return Err("launcher UID/GID does not match the signed capability subject".into());
    }
    Ed25519CapabilityVerifier::new(verification_key)
        .verify(&manifest.capability)
        .map_err(|error| format!("capability signature rejected: {error}"))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before UNIX epoch")?
        .as_secs();
    if claims.expires_at_unix <= now {
        return Err("worker capability has expired".into());
    }

    // The ACK permits only trusted bootstrap progress. Re-check the actual
    // cgroup before changing namespaces or execing the worker image.
    CgroupV2Boundary::verify_current(
        &manifest.cgroup_path,
        &manifest.capability.claims.budget,
        manifest.cpu_weight,
    )
    .map_err(|error| format!("effective cgroup boundary rejected: {error}"))?;

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
    if let Err(error) = drop_capability_authority() {
        child_fail(&format!("dropping capability authority failed: {error}"));
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
    if let Err(error) = clear_process_capability_sets() {
        child_fail(&format!("clearing process capabilities failed: {error}"));
    }
    if let Err(error) = apply_worker_rlimits() {
        child_fail(&format!("applying worker resource limits failed: {error}"));
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

fn drop_capability_authority() -> Result<(), String> {
    // Linux PRCTL values are stable UAPI constants. Fail closed if a required
    // capability transition is unavailable rather than relying on implicit
    // setuid behavior or inherited daemon securebits.
    const PR_SET_KEEPCAPS: libc::c_int = 8;
    const PR_CAPBSET_DROP: libc::c_int = 24;
    const PR_SET_SECUREBITS: libc::c_int = 28;
    const PR_CAP_AMBIENT: libc::c_int = 47;
    const PR_CAP_AMBIENT_CLEAR_ALL: libc::c_ulong = 4;
    const SECBIT_NOROOT: libc::c_ulong = 1;
    const SECBIT_NOROOT_LOCKED: libc::c_ulong = 2;

    if unsafe { libc::prctl(PR_SET_KEEPCAPS, 0, 0, 0, 0) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if unsafe {
        libc::prctl(
            PR_SET_SECUREBITS,
            SECBIT_NOROOT | SECBIT_NOROOT_LOCKED,
            0,
            0,
            0,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    if unsafe { libc::prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let last_cap: u32 = std::fs::read_to_string("/proc/sys/kernel/cap_last_cap")
        .map_err(|error| format!("cannot read kernel capability bound: {error}"))?
        .trim()
        .parse()
        .map_err(|error| format!("invalid kernel capability bound: {error}"))?;
    if last_cap > 63 {
        return Err(format!(
            "kernel capability index {last_cap} exceeds the supported capability-set width"
        ));
    }
    for capability in 0..=last_cap {
        if unsafe { libc::prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) } != 0 {
            return Err(format!(
                "PR_CAPBSET_DROP({capability}) failed: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

fn clear_process_capability_sets() -> Result<(), String> {
    #[repr(C)]
    struct CapHeader {
        version: u32,
        pid: i32,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CapData {
        effective: u32,
        permitted: u32,
        inheritable: u32,
    }

    const LINUX_CAPABILITY_VERSION_3: u32 = 0x2008_0522;
    let header = CapHeader {
        version: LINUX_CAPABILITY_VERSION_3,
        pid: 0,
    };
    let empty = CapData {
        effective: 0,
        permitted: 0,
        inheritable: 0,
    };
    let data = [empty, empty];
    if unsafe { libc::syscall(libc::SYS_capset, &header, data.as_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn apply_worker_rlimits() -> Result<(), String> {
    // Cgroup limits remain authoritative for CPU, memory and task count.
    // These rlimits additionally prevent core dumps and unbounded FD fan-out.
    const WORKER_NOFILE_LIMIT: libc::rlim_t = 256;
    for (resource, limit, label) in [
        (libc::RLIMIT_CORE, 0 as libc::rlim_t, "RLIMIT_CORE"),
        (libc::RLIMIT_NOFILE, WORKER_NOFILE_LIMIT, "RLIMIT_NOFILE"),
    ] {
        let limits = libc::rlimit {
            rlim_cur: limit,
            rlim_max: limit,
        };
        if unsafe { libc::setrlimit(resource, &limits) } != 0 {
            return Err(format!(
                "setrlimit({label}) failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut actual = std::mem::MaybeUninit::<libc::rlimit>::uninit();
        if unsafe { libc::getrlimit(resource, actual.as_mut_ptr()) } != 0 {
            return Err(format!(
                "getrlimit({label}) failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let actual = unsafe { actual.assume_init() };
        if actual.rlim_cur != limit || actual.rlim_max != limit {
            return Err(format!(
                "effective {label} differs from requested sandbox limit"
            ));
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_rlimits_are_finite_and_read_back_exactly() {
        const CHILD_MARKER: &str = "KLYN_RLIMIT_TEST_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            apply_worker_rlimits().expect("apply worker rlimits");
            let mut core = std::mem::MaybeUninit::<libc::rlimit>::uninit();
            let mut nofile = std::mem::MaybeUninit::<libc::rlimit>::uninit();
            assert_eq!(
                unsafe { libc::getrlimit(libc::RLIMIT_CORE, core.as_mut_ptr()) },
                0
            );
            assert_eq!(
                unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, nofile.as_mut_ptr()) },
                0
            );
            let core = unsafe { core.assume_init() };
            let nofile = unsafe { nofile.assume_init() };
            assert_eq!((core.rlim_cur, core.rlim_max), (0, 0));
            assert_eq!((nofile.rlim_cur, nofile.rlim_max), (256, 256));
            return;
        }

        let output = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("worker_rlimits_are_finite_and_read_back_exactly")
            .arg("--nocapture")
            .env(CHILD_MARKER, "1")
            .output()
            .expect("spawn isolated rlimit test process");
        assert!(
            output.status.success(),
            "rlimit child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
