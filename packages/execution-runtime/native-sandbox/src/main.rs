use libc::{
    c_int, c_ulong, c_void, kill, mount, prctl, setgid, setuid, syscall, umount2, waitpid,
    CLONE_NEWIPC, CLONE_NEWNET, CLONE_NEWNS, CLONE_NEWPID, CLONE_NEWUSER, MS_BIND, MS_REC,
    MS_REMOUNT, MS_RDONLY, MS_PRIVATE, MNT_DETACH, PR_SET_NO_NEW_PRIVS, SIGKILL, SIGSYS,
    SIGCHLD, SYS_seccomp, SECCOMP_FILTER_FLAG_TSYNC, SECCOMP_SET_MODE_FILTER,
    SECCOMP_RET_ALLOW, SECCOMP_RET_KILL_PROCESS,
};
use serde::Deserialize;
use std::env;
use std::ffi::{CString, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{self, Command};

const CGROUP_ROOT: &str = "/sys/fs/cgroup";
const CGROUP_PREFIX: &str = "klyn";

#[derive(Debug, Deserialize)]
struct Config {
    workspace: PathBuf,
    executable: PathBuf,
    args: Vec<String>,
    cgroup_id: String,
    timeout_ms: u64,
    memory_bytes: u64,
    cpu_max_us: u64,
    cpu_period_us: u64,
    pids_max: u64,
    io_max_read_bps: Option<u64>,
    io_max_write_bps: Option<u64>,
    uid: Option<u32>,
    gid: Option<u32>,
    syscall_profile: String,
}

fn fail(message: impl AsRef<str>) -> ! {
    eprintln!("[klyn-sandbox] {}", message.as_ref());
    process::exit(125);
}

fn write_file(path: &Path, value: &str) -> io::Result<()> {
    fs::write(path, value)
}

fn ensure_linux() {
    if !cfg!(target_os = "linux") {
        fail("the native sandbox is Linux-only");
    }
}

fn validate_abs_dir(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "workspace must be absolute"));
    }
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "workspace is not a directory"));
    }
    Ok(canonical)
}

fn cgroup_path(id: &str) -> io::Result<PathBuf> {
    if id.is_empty() || id.len() > 96 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid cgroup id"));
    }
    let root = Path::new(CGROUP_ROOT).join(CGROUP_PREFIX);
    fs::create_dir_all(&root)?;
    Ok(root.join(id))
}

fn setup_cgroup(cfg: &Config) -> io::Result<PathBuf> {
    let path = cgroup_path(&cfg.cgroup_id)?;
    fs::create_dir(&path)?;
    write_file(&path.join("memory.max"), &cfg.memory_bytes.to_string())?;
    write_file(&path.join("memory.swap.max"), "0")?;
    write_file(&path.join("pids.max"), &cfg.pids_max.to_string())?;
    write_file(
        &path.join("cpu.max"),
        &format!("{} {}", cfg.cpu_max_us, cfg.cpu_period_us),
    )?;
    write_file(&path.join("cgroup.procs"), &process::id().to_string())?;

    if cfg.io_max_read_bps.is_some() || cfg.io_max_write_bps.is_some() {
        let meta = fs::metadata(&cfg.workspace)?;
        let major = unsafe { libc::major(meta.dev() as c_ulong) };
        let minor = unsafe { libc::minor(meta.dev() as c_ulong) };
        let mut line = format!("{}:{}", major, minor);
        if let Some(v) = cfg.io_max_read_bps {
            line.push_str(&format!(" rbps={}", v));
        }
        if let Some(v) = cfg.io_max_write_bps {
            line.push_str(&format!(" wbps={}", v));
        }
        write_file(&path.join("io.max"), &line)?;
    }
    Ok(path)
}

fn cleanup_cgroup(path: &Path) {
    let _ = fs::remove_file(path.join("cgroup.kill"));
    let _ = fs::remove_dir(path);
}

fn bind_read_only(path: &Path) -> io::Result<()> {
    let c = CString::new(path.as_os_str().as_bytes()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid mount path"))?;
    let rc = unsafe {
        mount(
            c.as_ptr(),
            c.as_ptr(),
            std::ptr::null(),
            MS_BIND | MS_REC,
            std::ptr::null(),
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    let rc = unsafe {
        mount(
            std::ptr::null(),
            c.as_ptr(),
            std::ptr::null(),
            MS_BIND | MS_REMOUNT | MS_RDONLY | MS_REC,
            std::ptr::null(),
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn setup_mount_namespace(workspace: &Path) -> io::Result<()> {
    let rc = unsafe { libc::unshare(CLONE_NEWNS) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    let private = CString::new("/").unwrap();
    if unsafe {
        mount(
            std::ptr::null(),
            private.as_ptr(),
            std::ptr::null(),
            MS_PRIVATE | MS_REC,
            std::ptr::null(),
        )
    } != 0 {
        return Err(io::Error::last_os_error());
    }
    // The execution workspace is intentionally read-only at the OS boundary.
    // Writable artifacts must live in a separately provisioned output mount.
    bind_read_only(workspace)?;
    Ok(())
}

fn install_seccomp(profile: &str) -> io::Result<()> {
    if profile != "strict-linux-v1" {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "unknown seccomp profile"));
    }

    // Architecture-independent common execution profile. Unknown syscalls are killed.
    // This deliberately excludes ptrace, mount, namespace creation, module loading,
    // raw reboot/kexec, keyring manipulation, bpf/perf, and process injection.
    let allowed: &[c_int] = &[
        libc::SYS_read as c_int, libc::SYS_write as c_int, libc::SYS_close as c_int,
        libc::SYS_fstat as c_int, libc::SYS_newfstatat as c_int, libc::SYS_lseek as c_int,
        libc::SYS_pread64 as c_int, libc::SYS_pwrite64 as c_int, libc::SYS_readv as c_int,
        libc::SYS_writev as c_int, libc::SYS_ioctl as c_int, libc::SYS_poll as c_int,
        libc::SYS_ppoll as c_int, libc::SYS_select as c_int, libc::SYS_pselect6 as c_int,
        libc::SYS_epoll_create1 as c_int, libc::SYS_epoll_ctl as c_int,
        libc::SYS_epoll_wait as c_int, libc::SYS_epoll_pwait as c_int,
        libc::SYS_futex as c_int, libc::SYS_nanosleep as c_int, libc::SYS_clock_gettime as c_int,
        libc::SYS_getpid as c_int, libc::SYS_getppid as c_int, libc::SYS_gettid as c_int,
        libc::SYS_getuid as c_int, libc::SYS_geteuid as c_int, libc::SYS_getgid as c_int,
        libc::SYS_getegid as c_int, libc::SYS_getcwd as c_int, libc::SYS_uname as c_int,
        libc::SYS_arch_prctl as c_int, libc::SYS_set_tid_address as c_int,
        libc::SYS_set_robust_list as c_int, libc::SYS_rseq as c_int,
        libc::SYS_rt_sigaction as c_int, libc::SYS_rt_sigprocmask as c_int,
        libc::SYS_rt_sigreturn as c_int, libc::SYS_sigaltstack as c_int,
        libc::SYS_exit as c_int, libc::SYS_exit_group as c_int, libc::SYS_wait4 as c_int,
        libc::SYS_clone as c_int, libc::SYS_clone3 as c_int, libc::SYS_execve as c_int,
        libc::SYS_execveat as c_int, libc::SYS_prlimit64 as c_int,
        libc::SYS_mmap as c_int, libc::SYS_mprotect as c_int, libc::SYS_munmap as c_int,
        libc::SYS_madvise as c_int, libc::SYS_brk as c_int,
        libc::SYS_openat as c_int, libc::SYS_openat2 as c_int, libc::SYS_dup as c_int,
        libc::SYS_dup2 as c_int, libc::SYS_dup3 as c_int, libc::SYS_pipe as c_int,
        libc::SYS_pipe2 as c_int, libc::SYS_fcntl as c_int, libc::SYS_flock as c_int,
        libc::SYS_getdents64 as c_int, libc::SYS_statx as c_int,
        libc::SYS_prctl as c_int, libc::SYS_sched_getaffinity as c_int,
        libc::SYS_sched_yield as c_int, libc::SYS_setpriority as c_int,
        libc::SYS_getrandom as c_int, libc::SYS_sysinfo as c_int,
        libc::SYS_socket as c_int, libc::SYS_socketpair as c_int,
        libc::SYS_connect as c_int, libc::SYS_sendto as c_int, libc::SYS_recvfrom as c_int,
        libc::SYS_sendmsg as c_int, libc::SYS_recvmsg as c_int, libc::SYS_shutdown as c_int,
        libc::SYS_bind as c_int, libc::SYS_listen as c_int, libc::SYS_accept as c_int,
        libc::SYS_accept4 as c_int, libc::SYS_setsockopt as c_int, libc::SYS_getsockopt as c_int,
        libc::SYS_getsockname as c_int, libc::SYS_getpeername as c_int,
        libc::SYS_chdir as c_int, libc::SYS_fchdir as c_int, libc::SYS_readlinkat as c_int,
        libc::SYS_unlinkat as c_int, libc::SYS_mkdirat as c_int, libc::SYS_renameat as c_int,
        libc::SYS_renameat2 as c_int, libc::SYS_linkat as c_int, libc::SYS_symlinkat as c_int,
        libc::SYS_fchmodat as c_int, libc::SYS_fchmod as c_int, libc::SYS_fchownat as c_int,
        libc::SYS_umask as c_int, libc::SYS_getrlimit as c_int, libc::SYS_setrlimit as c_int,
    ];

    let mut filters: Vec<libc::sock_filter> = Vec::with_capacity(allowed.len() * 2 + 5);
    // Load seccomp_data.nr.
    filters.push(libc::sock_filter {
        code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16,
        jt: 0,
        jf: 0,
        k: 0,
    });
    for &nr in allowed {
        filters.push(libc::sock_filter {
            code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
            jt: 1,
            jf: 0,
            k: nr as u32,
        });
        filters.push(libc::sock_filter {
            code: (libc::BPF_RET | libc::BPF_K) as u16,
            jt: 0,
            jf: 0,
            k: SECCOMP_RET_ALLOW,
        });
    }
    filters.push(libc::sock_filter {
        code: (libc::BPF_RET | libc::BPF_K) as u16,
        jt: 0,
        jf: 0,
        k: SECCOMP_RET_KILL_PROCESS,
    });

    let mut prog = libc::sock_fprog {
        len: filters.len() as u16,
        filter: filters.as_mut_ptr(),
    };

    if unsafe { prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let rc = unsafe {
        syscall(
            SYS_seccomp,
            SECCOMP_SET_MODE_FILTER,
            SECCOMP_FILTER_FLAG_TSYNC,
            &mut prog as *mut libc::sock_fprog,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn deny_network() -> io::Result<()> {
    // The network namespace starts isolated. Loopback remains available only if
    // explicitly configured by a future policy; no host network namespace is joined.
    let rc = unsafe { libc::unshare(CLONE_NEWNET) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn setup_user_namespace(uid: u32, gid: u32) -> io::Result<()> {
    let rc = unsafe { libc::unshare(CLONE_NEWUSER) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    fs::write("/proc/self/setgroups", "deny").ok();
    fs::write("/proc/self/uid_map", format!("{} {} 1\n", 0, uid))?;
    fs::write("/proc/self/gid_map", format!("{} {} 1\n", 0, gid))?;
    Ok(())
}

fn setup_ipc_namespace() -> io::Result<()> {
    let rc = unsafe { libc::unshare(CLONE_NEWIPC) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn spawn_isolated(cfg: &Config, cgroup: &Path) -> io::Result<i32> {
    let uid = cfg.uid.unwrap_or_else(|| unsafe { libc::getuid() });
    let gid = cfg.gid.unwrap_or_else(|| unsafe { libc::getgid() });

    // User namespace first; subsequent namespace operations can be authorized
    // without retaining host capabilities on kernels permitting unprivileged userns.
    setup_user_namespace(uid, gid)?;
    setup_mount_namespace(&cfg.workspace)?;
    deny_network()?;
    setup_ipc_namespace()?;

    // PID namespace requires a child after unshare.
    if unsafe { libc::unshare(CLONE_NEWPID) } != 0 {
        return Err(io::Error::last_os_error());
    }

    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(io::Error::last_os_error());
    }
    if pid == 0 {
        if let Err(e) = install_seccomp(&cfg.syscall_profile) {
            eprintln!("[klyn-sandbox] seccomp: {e}");
            unsafe { libc::_exit(126) };
        }
        if let Some(g) = cfg.gid { unsafe { setgid(g); } }
        if let Some(u) = cfg.uid { unsafe { setuid(u); } }

        let exe = CString::new(cfg.executable.as_os_str().as_bytes()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid executable"))?;
        let mut argv = Vec::with_capacity(cfg.args.len() + 1);
        argv.push(exe.as_ptr());
        let cargs: Vec<CString> = cfg.args.iter().map(|a| CString::new(a.as_str()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in argument"))).collect::<io::Result<_>>()?;
        argv.extend(cargs.iter().map(|s| s.as_ptr()));
        argv.push(std::ptr::null());

        let env: Vec<(OsString, OsString)> = env::vars_os().collect();
        let cenv: Vec<CString> = env.iter().map(|(k,v)| CString::new(format!("{}={}", k.to_string_lossy(), v.to_string_lossy())).unwrap()).collect();
        let mut envp: Vec<*const i8> = cenv.iter().map(|s| s.as_ptr()).collect();
        envp.push(std::ptr::null());

        unsafe {
            libc::chdir(CString::new(cfg.workspace.as_os_str().as_bytes()).unwrap().as_ptr());
            libc::execve(exe.as_ptr(), argv.as_ptr(), envp.as_ptr());
            libc::_exit(127);
        }
    }

    let _ = write_file(&cgroup.join("cgroup.procs"), &pid.to_string());
    let mut status: c_int = 0;
    loop {
        let rc = unsafe { waitpid(pid, &mut status, 0) };
        if rc == pid { break; }
        if rc < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
            return Err(io::Error::last_os_error());
        }
    }

    if unsafe { libc::WIFEXITED(status) } {
        Ok(unsafe { libc::WEXITSTATUS(status) })
    } else if unsafe { libc::WIFSIGNALED(status) } {
        Ok(128 + unsafe { libc::WTERMSIG(status) })
    } else {
        Ok(125)
    }
}

fn main() {
    ensure_linux();

    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        fail(format!("cannot read request: {e}"));
    }
    let cfg: Config = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => fail(format!("invalid request JSON: {e}")),
    };

    if cfg.timeout_ms == 0 || cfg.memory_bytes == 0 || cfg.cpu_max_us == 0 || cfg.cpu_period_us == 0 || cfg.pids_max == 0 {
        fail("resource limits must be positive");
    }
    let workspace = match validate_abs_dir(&cfg.workspace) {
        Ok(v) => v,
        Err(e) => fail(format!("workspace validation failed: {e}")),
    };
    let executable = match fs::canonicalize(&cfg.executable) {
        Ok(v) => v,
        Err(e) => fail(format!("executable validation failed: {e}")),
    };
    if !executable.is_file() {
        fail("executable is not a regular file");
    }

    let cfg = Config { workspace, executable, ..cfg };

    let cgroup = match setup_cgroup(&cfg) {
        Ok(v) => v,
        Err(e) => fail(format!("cgroup setup failed: {e}")),
    };

    let result = spawn_isolated(&cfg, &cgroup);
    let _ = write_file(&cgroup.join("cgroup.kill"), "1");
    cleanup_cgroup(&cgroup);

    match result {
        Ok(code) => process::exit(code),
        Err(e) => fail(format!("sandbox execution failed: {e}")),
    }
}
