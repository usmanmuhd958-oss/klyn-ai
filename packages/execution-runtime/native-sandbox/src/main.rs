use libc::{c_int, c_ulong, mount, prctl, syscall, waitpid, CLONE_NEWIPC, CLONE_NEWNET, CLONE_NEWNS, CLONE_NEWPID, CLONE_NEWUSER, MS_BIND, MS_PRIVATE, MS_RDONLY, MS_REC, MS_REMOUNT, PR_SET_NO_NEW_PRIVS};
use serde::Deserialize;
use std::{env, fs, io::{self, Read}, os::unix::{ffi::OsStrExt, fs::MetadataExt}, path::{Path, PathBuf}, process, thread, time::Duration};
use std::ffi::CString;

const CGROUP_ROOT: &str = "/sys/fs/cgroup";
const CGROUP_PARENT: &str = "/sys/fs/cgroup/klyn";

#[derive(Debug, Deserialize)]
struct Config {
    workspace: PathBuf,
    rootfs: PathBuf,
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
    syscall_profile: String,
}

fn fail(msg: impl AsRef<str>) -> ! {
    eprintln!("[klyn-sandbox] {}", msg.as_ref());
    process::exit(125);
}

fn write(path: &Path, value: &str) -> io::Result<()> { fs::write(path, value) }

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 96 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn canonical_dir(path: &Path, name: &str) -> io::Result<PathBuf> {
    if !path.is_absolute() { return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("{name} must be absolute"))); }
    let p = fs::canonicalize(path)?;
    if !p.is_dir() { return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("{name} must be a directory"))); }
    Ok(p)
}

fn cgroup_path(id: &str) -> io::Result<PathBuf> {
    if !valid_id(id) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid cgroup id")); }
    fs::create_dir_all(CGROUP_PARENT)?;
    let p = Path::new(CGROUP_PARENT).join(id);
    fs::create_dir(&p)?;
    Ok(p)
}

fn require_controllers() -> io::Result<()> {
    let available = fs::read_to_string(Path::new(CGROUP_ROOT).join("cgroup.controllers"))?;
    for controller in ["memory", "cpu", "pids", "io"] {
        if !available.split_whitespace().any(|v| v == controller) {
            return Err(io::Error::new(io::ErrorKind::Unsupported, format!("cgroup controller unavailable: {controller}")));
        }
    }
    Ok(())
}

fn setup_cgroup(cfg: &Config) -> io::Result<PathBuf> {
    require_controllers()?;
    let p = cgroup_path(&cfg.cgroup_id)?;
    write(&p.join("memory.max"), &cfg.memory_bytes.to_string())?;
    write(&p.join("memory.swap.max"), "0")?;
    write(&p.join("pids.max"), &cfg.pids_max.to_string())?;
    write(&p.join("cpu.max"), &format!("{} {}", cfg.cpu_max_us, cfg.cpu_period_us))?;
    let dev = fs::metadata(&cfg.workspace)?.dev();
    let major = unsafe { libc::major(dev as c_ulong) };
    let minor = unsafe { libc::minor(dev as c_ulong) };
    if cfg.io_max_read_bps.is_some() || cfg.io_max_write_bps.is_some() {
        let mut rule = format!("{}:{}", major, minor);
        if let Some(v) = cfg.io_max_read_bps { rule.push_str(&format!(" rbps={v}")); }
        if let Some(v) = cfg.io_max_write_bps { rule.push_str(&format!(" wbps={v}")); }
        write(&p.join("io.max"), &rule)?;
    }
    Ok(p)
}

fn join_cgroup(path: &Path, pid: libc::pid_t) -> io::Result<()> { write(&path.join("cgroup.procs"), &pid.to_string()) }

fn kill_cgroup(path: &Path) {
    let _ = write(&path.join("cgroup.kill"), "1");
}

fn cleanup_cgroup(path: &Path) { let _ = fs::remove_dir(path); }

fn bind(src: &Path, dst: &Path, readonly: bool) -> io::Result<()> {
    if !src.exists() || !dst.exists() { return Err(io::Error::new(io::ErrorKind::NotFound, "mount source/target missing")); }
    let s = CString::new(src.as_os_str().as_bytes()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in source"))?;
    let d = CString::new(dst.as_os_str().as_bytes()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in target"))?;
    if unsafe { mount(s.as_ptr(), d.as_ptr(), std::ptr::null(), MS_BIND | MS_REC, std::ptr::null()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if readonly && unsafe { mount(std::ptr::null(), d.as_ptr(), std::ptr::null(), MS_BIND | MS_REMOUNT | MS_RDONLY | MS_REC, std::ptr::null()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn mount_namespace(rootfs: &Path, workspace: &Path) -> io::Result<()> {
    if unsafe { libc::unshare(CLONE_NEWNS) } != 0 { return Err(io::Error::last_os_error()); }
    let slash = CString::new("/").unwrap();
    if unsafe { mount(std::ptr::null(), slash.as_ptr(), std::ptr::null(), MS_PRIVATE | MS_REC, std::ptr::null()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let root = rootfs.join("workspace");
    if !root.exists() { return Err(io::Error::new(io::ErrorKind::NotFound, "rootfs must contain /workspace")); }
    bind(rootfs, rootfs, true)?;
    bind(workspace, &root, false)?;
    Ok(())
}

fn user_namespace() -> io::Result<()> {
    if unsafe { libc::unshare(CLONE_NEWUSER) } != 0 { return Err(io::Error::last_os_error()); }
    fs::write("/proc/self/setgroups", "deny").ok();
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };
    fs::write("/proc/self/uid_map", format!("0 {uid} 1\n"))?;
    fs::write("/proc/self/gid_map", format!("0 {gid} 1\n"))?;
    Ok(())
}

fn network_namespace() -> io::Result<()> {
    if unsafe { libc::unshare(CLONE_NEWNET) } != 0 { return Err(io::Error::last_os_error()); }
    Ok(())
}

fn ipc_namespace() -> io::Result<()> {
    if unsafe { libc::unshare(CLONE_NEWIPC) } != 0 { return Err(io::Error::last_os_error()); }
    Ok(())
}

fn arch_ok(arch: u32) -> bool {
    #[cfg(target_arch = "x86_64")] { arch == 0xc000003e }
    #[cfg(target_arch = "aarch64")] { arch == 0xc00000b7 }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))] { let _ = arch; false }
}

fn seccomp(profile: &str) -> io::Result<()> {
    if profile != "strict-linux-v1" { return Err(io::Error::new(io::ErrorKind::InvalidInput, "unknown seccomp profile")); }
    // Default-deny allowlist. Network syscalls are intentionally absent; the network
    // namespace is also isolated. No mount, ptrace, bpf, perf, reboot, kexec, keyctl,
    // process_vm_*, setns, unshare, or module-loading syscalls are permitted.
    let allowed: &[c_int] = &[
        libc::SYS_read as c_int, libc::SYS_write as c_int, libc::SYS_close as c_int,
        libc::SYS_fstat as c_int, libc::SYS_newfstatat as c_int, libc::SYS_lseek as c_int,
        libc::SYS_pread64 as c_int, libc::SYS_pwrite64 as c_int, libc::SYS_readv as c_int,
        libc::SYS_writev as c_int, libc::SYS_ioctl as c_int, libc::SYS_poll as c_int,
        libc::SYS_ppoll as c_int, libc::SYS_epoll_create1 as c_int, libc::SYS_epoll_ctl as c_int,
        libc::SYS_epoll_wait as c_int, libc::SYS_epoll_pwait as c_int, libc::SYS_futex as c_int,
        libc::SYS_nanosleep as c_int, libc::SYS_clock_gettime as c_int, libc::SYS_getpid as c_int,
        libc::SYS_getppid as c_int, libc::SYS_gettid as c_int, libc::SYS_getuid as c_int,
        libc::SYS_geteuid as c_int, libc::SYS_getgid as c_int, libc::SYS_getegid as c_int,
        libc::SYS_getcwd as c_int, libc::SYS_uname as c_int, libc::SYS_arch_prctl as c_int,
        libc::SYS_set_tid_address as c_int, libc::SYS_set_robust_list as c_int, libc::SYS_rseq as c_int,
        libc::SYS_rt_sigaction as c_int, libc::SYS_rt_sigprocmask as c_int, libc::SYS_rt_sigreturn as c_int,
        libc::SYS_sigaltstack as c_int, libc::SYS_exit as c_int, libc::SYS_exit_group as c_int,
        libc::SYS_wait4 as c_int, libc::SYS_clone as c_int, libc::SYS_clone3 as c_int,
        libc::SYS_execve as c_int, libc::SYS_execveat as c_int, libc::SYS_prlimit64 as c_int,
        libc::SYS_mmap as c_int, libc::SYS_mprotect as c_int, libc::SYS_munmap as c_int,
        libc::SYS_madvise as c_int, libc::SYS_brk as c_int, libc::SYS_openat as c_int,
        libc::SYS_openat2 as c_int, libc::SYS_dup as c_int, libc::SYS_dup2 as c_int, libc::SYS_dup3 as c_int,
        libc::SYS_pipe as c_int, libc::SYS_pipe2 as c_int, libc::SYS_fcntl as c_int,
        libc::SYS_flock as c_int, libc::SYS_getdents64 as c_int, libc::SYS_statx as c_int,
        libc::SYS_prctl as c_int, libc::SYS_sched_getaffinity as c_int, libc::SYS_sched_yield as c_int,
        libc::SYS_getrandom as c_int, libc::SYS_sysinfo as c_int, libc::SYS_chdir as c_int,
        libc::SYS_fchdir as c_int, libc::SYS_readlinkat as c_int, libc::SYS_unlinkat as c_int,
        libc::SYS_mkdirat as c_int, libc::SYS_renameat as c_int, libc::SYS_renameat2 as c_int,
        libc::SYS_linkat as c_int, libc::SYS_symlinkat as c_int, libc::SYS_fchmodat as c_int,
        libc::SYS_fchmod as c_int, libc::SYS_fchownat as c_int, libc::SYS_umask as c_int,
        libc::SYS_getrlimit as c_int, libc::SYS_setrlimit as c_int,
    ];
    let mut f = Vec::with_capacity(allowed.len() * 2 + 5);
    f.push(libc::sock_filter { code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16, jt: 0, jf: 0, k: 4 });
    f.push(libc::sock_filter { code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16, jt: 0, jf: 1, k: 0 });
    f.push(libc::sock_filter { code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16, jt: 1, jf: 0, k: 0 });
    f.push(libc::sock_filter { code: (libc::BPF_RET | libc::BPF_K) as u16, jt: 0, jf: 0, k: libc::SECCOMP_RET_KILL_PROCESS });
    f.pop();
    // Replace the arch prelude with explicit load/compare/kill sequence.
    f.clear();
    f.push(libc::sock_filter { code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16, jt: 0, jf: 0, k: 4 });
    let arch = if cfg!(target_arch = "x86_64") { 0xc000003e } else { 0xc00000b7 };
    f.push(libc::sock_filter { code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16, jt: 1, jf: 0, k: arch });
    f.push(libc::sock_filter { code: (libc::BPF_RET | libc::BPF_K) as u16, jt: 0, jf: 0, k: libc::SECCOMP_RET_KILL_PROCESS });
    f.push(libc::sock_filter { code: (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16, jt: 0, jf: 0, k: 0 });
    for &nr in allowed {
        f.push(libc::sock_filter { code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16, jt: 1, jf: 0, k: nr as u32 });
        f.push(libc::sock_filter { code: (libc::BPF_RET | libc::BPF_K) as u16, jt: 0, jf: 0, k: libc::SECCOMP_RET_ALLOW });
    }
    f.push(libc::sock_filter { code: (libc::BPF_RET | libc::BPF_K) as u16, jt: 0, jf: 0, k: libc::SECCOMP_RET_KILL_PROCESS });
    let mut prog = libc::sock_fprog { len: f.len() as u16, filter: f.as_mut_ptr() };
    if unsafe { prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 { return Err(io::Error::last_os_error()); }
    let rc = unsafe { syscall(libc::SYS_seccomp, libc::SECCOMP_SET_MODE_FILTER, libc::SECCOMP_FILTER_FLAG_TSYNC, &mut prog) };
    if rc != 0 { return Err(io::Error::last_os_error()); }
    Ok(())
}

fn exec_child(cfg: &Config, rootfs: &Path) -> ! {
    if let Err(e) = seccomp(&cfg.syscall_profile) { eprintln!("[klyn-sandbox] seccomp: {e}"); process::exit(126); }
    if unsafe { libc::chroot(rootfs.as_os_str().as_bytes().as_ptr() as *const i8) } != 0 { process::exit(127); }
    if env::set_current_dir("/workspace").is_err() { process::exit(127); }

    let exe = CString::new(cfg.executable.as_os_str().as_bytes()).unwrap();
    let args: Vec<CString> = std::iter::once(cfg.executable.as_os_str().as_bytes().to_vec())
        .chain(cfg.args.iter().map(|a| a.as_bytes().to_vec()))
        .map(|a| CString::new(a).unwrap())
        .collect();
    let mut argv: Vec<*const i8> = args.iter().map(|a| a.as_ptr()).collect();
    argv.push(std::ptr::null());

    let vars: Vec<CString> = env::vars_os().map(|(k,v)| CString::new(format!("{}={}", k.to_string_lossy(), v.to_string_lossy())).unwrap()).collect();
    let mut envp: Vec<*const i8> = vars.iter().map(|v| v.as_ptr()).collect();
    envp.push(std::ptr::null());
    unsafe { libc::execve(exe.as_ptr(), argv.as_ptr(), envp.as_ptr()); }
    process::exit(127);
}

fn run(cfg: &Config, cgroup: &Path) -> io::Result<i32> {
    user_namespace()?;
    mount_namespace(&cfg.rootfs, &cfg.workspace)?;
    network_namespace()?;
    ipc_namespace()?;
    if unsafe { libc::unshare(CLONE_NEWPID) } != 0 { return Err(io::Error::last_os_error()); }

    let pid = unsafe { libc::fork() };
    if pid < 0 { return Err(io::Error::last_os_error()); }
    if pid == 0 {
        // Inside the user namespace uid 0 maps to the invoking host uid.
        exec_child(cfg, &cfg.rootfs);
    }

    join_cgroup(cgroup, pid)?;
    let killer = cgroup.to_path_buf();
    let timeout = cfg.timeout_ms;
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(timeout));
        kill_cgroup(&killer);
    });

    let mut status = 0;
    loop {
        let r = unsafe { waitpid(pid, &mut status, 0) };
        if r == pid { break; }
        if r < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted { return Err(io::Error::last_os_error()); }
    }
    if unsafe { libc::WIFEXITED(status) } { Ok(unsafe { libc::WEXITSTATUS(status) }) }
    else if unsafe { libc::WIFSIGNALED(status) } { Ok(128 + unsafe { libc::WTERMSIG(status) }) }
    else { Ok(125) }
}

fn main() {
    if !cfg!(target_os = "linux") { fail("Linux is required"); }
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) { fail(format!("stdin: {e}")); }
    let mut cfg: Config = serde_json::from_str(&input).unwrap_or_else(|e| fail(format!("invalid JSON: {e}")));
    if cfg.timeout_ms == 0 || cfg.memory_bytes == 0 || cfg.cpu_max_us == 0 || cfg.cpu_period_us == 0 || cfg.pids_max == 0 { fail("invalid resource limits"); }
    cfg.workspace = canonical_dir(&cfg.workspace, "workspace").unwrap_or_else(|e| fail(format!("workspace: {e}")));
    cfg.rootfs = canonical_dir(&cfg.rootfs, "rootfs").unwrap_or_else(|e| fail(format!("rootfs: {e}")));
    cfg.executable = fs::canonicalize(&cfg.executable).unwrap_or_else(|e| fail(format!("executable: {e}")));
    if !cfg.executable.is_file() || !cfg.executable.is_absolute() { fail("executable must be an absolute regular file"); }
    if !cfg.rootfs.join("workspace").is_dir() { fail("rootfs must contain a /workspace directory"); }

    let cg = setup_cgroup(&cfg).unwrap_or_else(|e| fail(format!("cgroup: {e}")));
    let result = run(&cfg, &cg);
    kill_cgroup(&cg);
    cleanup_cgroup(&cg);
    match result { Ok(code) => process::exit(code), Err(e) => fail(format!("execution: {e}")) }
}
