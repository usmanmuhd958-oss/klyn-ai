//! Hard-required Landlock filesystem rules and a default-deny seccomp profile.
//!
//! Install these only in a trusted, single-purpose worker bootstrap, after all
//! runtime initialization that requires direct path opens or process creation,
//! but before interpreting untrusted agent instructions.

use std::{collections::BTreeMap, os::fd::RawFd, path::PathBuf};

use landlock::{
    make_bitflags, Access, AccessFs, CompatLevel, Compatible, PathBeneath, RestrictSelfAttr,
    RestrictionStatus, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus, ABI,
};
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule,
};

use crate::{
    open_path_no_symlinks, validate_relative_path, validate_trusted_root, CapabilityClaims,
    FileAccess, SandboxError, WorkerOperation, BROKER_FD,
};

/// Apply a hard-required Landlock ABI v8 ruleset.
///
/// Roots must be daemon-controlled mappings from OCap root IDs to trusted
/// directory paths. Grant paths that traverse symlinks are rejected.
pub fn apply_landlock(
    claims: &CapabilityClaims,
    roots: &BTreeMap<String, PathBuf>,
) -> Result<RestrictionStatus, SandboxError> {
    claims.validate()?;
    let abi = ABI::V8;
    let mut ruleset = Ruleset::default()
        .set_compatibility(CompatLevel::HardRequirement)
        .handle_access(AccessFs::from_all(abi))
        .map_err(|e| SandboxError::Enforcement(format!("Landlock handle_access: {e}")))?
        .create()
        .map_err(|e| SandboxError::Enforcement(format!("Landlock create: {e}")))?;

    let mut normalized_roots = BTreeMap::new();
    for (id, path) in roots {
        if id.is_empty() || id.len() > 128 {
            return Err(SandboxError::InvalidConfig(
                "invalid trusted root id".into(),
            ));
        }
        let canonical = validate_trusted_root(path)?;
        normalized_roots.insert(id.as_str(), canonical);
    }

    for grant in &claims.file_grants {
        validate_relative_path(&grant.prefix, true)?;
        let root = normalized_roots
            .get(grant.root_id.as_str())
            .ok_or_else(|| {
                SandboxError::InvalidConfig(format!(
                    "OCap references an unconfigured filesystem root: {}",
                    grant.root_id
                ))
            })?;
        let requested = if grant.prefix.is_empty() {
            root.clone()
        } else {
            root.join(&grant.prefix)
        };
        let canonical = std::fs::canonicalize(&requested)?;
        if !canonical.starts_with(root) || canonical != requested {
            return Err(SandboxError::InvalidConfig(format!(
                "grant path escapes its trusted root or traverses a symlink: {}",
                requested.display()
            )));
        }

        // Pin the target inode with openat2 (no symlink or magic-link
        // resolution), then tailor directory-only rights to the pinned object.
        let target = open_path_no_symlinks(&canonical, false)?;
        let is_directory = target.metadata()?.is_dir();
        let access = match (grant.access, is_directory) {
            (FileAccess::Read, true) => make_bitflags!(AccessFs::{ReadFile | ReadDir}),
            (FileAccess::Read, false) => make_bitflags!(AccessFs::{ReadFile}),
            (FileAccess::Write, true) => make_bitflags!(AccessFs::{
                WriteFile | Truncate | MakeDir | MakeReg | RemoveDir | RemoveFile
            }),
            (FileAccess::Write, false) => make_bitflags!(AccessFs::{WriteFile | Truncate}),
            (FileAccess::ReadWrite, true) => make_bitflags!(AccessFs::{
                ReadFile | ReadDir | WriteFile | Truncate | MakeDir | MakeReg | RemoveDir | RemoveFile
            }),
            (FileAccess::ReadWrite, false) => {
                make_bitflags!(AccessFs::{ReadFile | WriteFile | Truncate})
            }
        };
        ruleset = ruleset
            .add_rule(PathBeneath::new(target, access))
            .map_err(|e| SandboxError::Enforcement(format!("Landlock add_rule: {e}")))?;
    }

    // ABI v8 is required to avoid an unrestricted sibling thread.
    let ruleset = ruleset
        .all_threads(true)
        .map_err(|e| SandboxError::Enforcement(format!("Landlock all_threads: {e}")))?;
    let status = ruleset
        .restrict_self()
        .map_err(|e| SandboxError::Enforcement(format!("Landlock restrict_self: {e}")))?;
    if status.ruleset != RulesetStatus::FullyEnforced || !status.no_new_privs || !status.all_threads
    {
        return Err(SandboxError::Enforcement(format!(
            "Landlock returned incomplete enforcement status: {status:?}"
        )));
    }
    Ok(status)
}

/// Build and install a default-deny seccomp profile.
///
/// The profile permits a focused set of data-plane syscalls but denies direct
/// filesystem path opens, process creation/execution, socket creation/connect,
/// io_uring, ptrace, and outbound SCM_RIGHTS. The only recvmsg permitted is on
/// the pre-established broker descriptor, expected to be FD 3.
pub fn apply_worker_seccomp(broker_fd: RawFd) -> Result<(), SandboxError> {
    apply_worker_seccomp_for(broker_fd, WorkerOperation::Control)
}

/// Install the minimal syscall policy associated with a signed registered task.
/// Every profile kills the worker for any syscall outside its allowlist. The
/// default-deny action cannot be caught or converted back into task execution.
pub fn apply_worker_seccomp_for(
    broker_fd: RawFd,
    operation: WorkerOperation,
) -> Result<(), SandboxError> {
    if broker_fd != BROKER_FD {
        return Err(SandboxError::InvalidConfig(format!(
            "the seccomp profile is pinned to broker fd {BROKER_FD}, got {broker_fd}"
        )));
    }
    if unsafe { libc::fcntl(broker_fd, libc::F_GETFD) } < 0 {
        return Err(SandboxError::Enforcement(
            "broker descriptor is not open".into(),
        ));
    }
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(SandboxError::Enforcement(format!(
            "PR_SET_NO_NEW_PRIVS failed: {}",
            std::io::Error::last_os_error()
        )));
    }

    let mut rules: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();
    let allowed: &[i64] = match operation {
        WorkerOperation::Control => &[
            libc::SYS_read,
            libc::SYS_write,
            libc::SYS_readv,
            libc::SYS_writev,
            libc::SYS_close,
            libc::SYS_fstat,
            libc::SYS_lseek,
            libc::SYS_pread64,
            libc::SYS_pwrite64,
            libc::SYS_ftruncate,
            libc::SYS_mmap,
            libc::SYS_mprotect,
            libc::SYS_munmap,
            libc::SYS_brk,
            libc::SYS_madvise,
            libc::SYS_mremap,
            libc::SYS_rt_sigaction,
            libc::SYS_rt_sigprocmask,
            libc::SYS_rt_sigreturn,
            libc::SYS_sigaltstack,
            libc::SYS_getpid,
            libc::SYS_getppid,
            libc::SYS_gettid,
            libc::SYS_getuid,
            libc::SYS_geteuid,
            libc::SYS_getgid,
            libc::SYS_getegid,
            libc::SYS_getrandom,
            libc::SYS_clock_gettime,
            libc::SYS_clock_getres,
            libc::SYS_gettimeofday,
            libc::SYS_nanosleep,
            libc::SYS_clock_nanosleep,
            libc::SYS_sched_yield,
            libc::SYS_futex,
            libc::SYS_restart_syscall,
            libc::SYS_poll,
            libc::SYS_ppoll,
            libc::SYS_pselect6,
            libc::SYS_select,
            libc::SYS_epoll_create1,
            libc::SYS_epoll_ctl,
            libc::SYS_epoll_wait,
            libc::SYS_epoll_pwait,
            libc::SYS_uname,
            libc::SYS_exit,
            libc::SYS_exit_group,
            libc::SYS_fsync,
            libc::SYS_fdatasync,
            libc::SYS_getcwd,
        ],
        WorkerOperation::HashJson => &[
            libc::SYS_read,
            libc::SYS_write,
            libc::SYS_close,
            libc::SYS_fstat,
            libc::SYS_mmap,
            libc::SYS_mprotect,
            libc::SYS_munmap,
            libc::SYS_brk,
            libc::SYS_madvise,
            libc::SYS_mremap,
            libc::SYS_rt_sigaction,
            libc::SYS_rt_sigprocmask,
            libc::SYS_rt_sigreturn,
            libc::SYS_sigaltstack,
            libc::SYS_getpid,
            libc::SYS_gettid,
            libc::SYS_getrandom,
            libc::SYS_clock_gettime,
            libc::SYS_futex,
            libc::SYS_restart_syscall,
            libc::SYS_exit,
            libc::SYS_exit_group,
        ],
        WorkerOperation::DescribeJson => &[
            libc::SYS_read,
            libc::SYS_write,
            libc::SYS_close,
            libc::SYS_fstat,
            libc::SYS_lseek,
            libc::SYS_pread64,
            libc::SYS_mmap,
            libc::SYS_mprotect,
            libc::SYS_munmap,
            libc::SYS_brk,
            libc::SYS_madvise,
            libc::SYS_mremap,
            libc::SYS_rt_sigaction,
            libc::SYS_rt_sigprocmask,
            libc::SYS_rt_sigreturn,
            libc::SYS_sigaltstack,
            libc::SYS_getpid,
            libc::SYS_gettid,
            libc::SYS_getrandom,
            libc::SYS_clock_gettime,
            libc::SYS_futex,
            libc::SYS_restart_syscall,
            libc::SYS_exit,
            libc::SYS_exit_group,
        ],
    };
    for syscall in allowed.iter().copied() {
        rules.entry(syscall).or_default();
    }

    // Only allow descriptor reception on the broker channel. sendmsg is denied.
    let broker_only_recvmsg = SeccompRule::new(vec![SeccompCondition::new(
        0,
        SeccompCmpArgLen::Dword,
        SeccompCmpOp::Eq,
        BROKER_FD as u64,
    )
    .map_err(|e| SandboxError::Enforcement(format!("seccomp condition: {e}")))?])
    .map_err(|e| SandboxError::Enforcement(format!("seccomp rule: {e}")))?;
    rules.insert(libc::SYS_recvmsg, vec![broker_only_recvmsg]);

    let architecture = std::env::consts::ARCH
        .try_into()
        .map_err(|e| SandboxError::Enforcement(format!("unsupported seccomp architecture: {e}")))?;
    let filter = SeccompFilter::new(
        rules,
        SeccompAction::KillProcess,
        SeccompAction::Allow,
        architecture,
    )
    .map_err(|e| SandboxError::Enforcement(format!("seccomp filter creation: {e}")))?;
    let program: BpfProgram = filter
        .try_into()
        .map_err(|e| SandboxError::Enforcement(format!("seccomp BPF compilation: {e}")))?;
    seccompiler::apply_filter_all_threads(&program)
        .map_err(|e| SandboxError::Enforcement(format!("seccomp TSYNC install: {e}")))?;
    Ok(())
}

/// Apply worker isolation. Callers must terminate on error.
pub fn enforce_worker(
    claims: &CapabilityClaims,
    roots: &BTreeMap<String, PathBuf>,
    broker_fd: RawFd,
) -> Result<(), SandboxError> {
    apply_landlock(claims, roots)?;
    apply_worker_seccomp_for(broker_fd, claims.operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ResourceBudget, SignedCapability};
    use std::{ffi::CString, os::fd::AsRawFd, os::unix::net::UnixStream, process::Command};

    /// GitLab's shared runner currently exposes Linux 5.15, which predates
    /// Landlock ABI v8. Runtime enforcement must remain fail-closed, but the
    /// CI test should verify that behavior instead of failing before exercising
    /// the rest of the sandbox. Supported runners still execute the full
    /// restriction and negative-case checks below.
    fn require_landlock_v8_or_assert_fail_closed() -> bool {
        const LANDLOCK_CREATE_RULESET_VERSION: libc::c_uint = 1;
        let abi = unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                std::ptr::null::<libc::c_void>(),
                0usize,
                LANDLOCK_CREATE_RULESET_VERSION,
            )
        };
        if abi >= 8 {
            return true;
        }

        let native_qualification_required =
            std::env::var("KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION")
                .is_ok_and(|value| value == "1");
        if native_qualification_required {
            panic!(
                "native Linux qualification requires Landlock ABI v8 or newer; kernel reported ABI {abi}"
            );
        }
        eprintln!(
            "SKIP: Landlock ABI v8 is unavailable (kernel reported ABI {abi}); policy installation must still fail closed"
        );
        assert!(
            apply_landlock(&claims(), &BTreeMap::new()).is_err(),
            "sandbox must refuse Landlock enforcement when ABI v8 is unavailable"
        );
        false
    }

    fn claims() -> CapabilityClaims {
        CapabilityClaims {
            version: crate::OCAP_VERSION,
            token_id: "landlock-test".into(),
            subject_uid: (unsafe { libc::geteuid() }).max(1) as u32,
            subject_gid: unsafe { libc::getegid() } as u32,
            expires_at_unix: u64::MAX,
            file_grants: vec![],
            network_grants: vec![],
            operation: WorkerOperation::Control,
            budget: ResourceBudget {
                memory_max_bytes: 16 * 1024 * 1024,
                cpu_quota_micros: 100_000,
                cpu_period_micros: 100_000,
                pids_max: 4,
                io_limits: vec![],
            },
        }
    }

    #[test]
    fn landlock_requires_supported_abi_and_all_threads() {
        if !require_landlock_v8_or_assert_fail_closed() {
            return;
        }
        const CHILD_MARKER: &str = "KLYN_LANDLOCK_STATUS_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            let roots = BTreeMap::new();
            let status = apply_landlock(&claims(), &roots)
                .expect("required Landlock features are unavailable");
            assert_eq!(status.ruleset, RulesetStatus::FullyEnforced);
            assert!(status.no_new_privs);
            assert!(status.all_threads);
            return;
        }

        // Landlock with all_threads(true) intentionally confines the current
        // process. Run this assertion in a subprocess so parallel Rust tests
        // don't inherit the restricted process-wide filesystem policy.
        let output = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("landlock_seccomp::tests::landlock_requires_supported_abi_and_all_threads")
            .arg("--nocapture")
            .env(CHILD_MARKER, "1")
            .output()
            .expect("spawn isolated Landlock status test process");
        assert!(
            output.status.success(),
            "Landlock status child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn reject_missing_grant_root_before_policy_installation() {
        let mut c = claims();
        c.file_grants.push(crate::FileGrant {
            root_id: "missing".into(),
            prefix: "".into(),
            access: FileAccess::Read,
        });
        assert!(apply_landlock(&c, &BTreeMap::new()).is_err());
    }

    #[test]
    fn operation_selector_is_signed_and_legacy_control_claims_keep_their_wire_shape() {
        let mut c = claims();
        let legacy = serde_json::to_value(&c).expect("serialize legacy control claims");
        assert!(legacy.get("operation").is_none());

        c.operation = WorkerOperation::HashJson;
        let hash = serde_json::to_value(&c).expect("serialize hash operation claims");
        assert_eq!(
            hash.get("operation").and_then(serde_json::Value::as_str),
            Some("hash_json")
        );

        c.operation = WorkerOperation::DescribeJson;
        let describe = serde_json::to_value(&c).expect("serialize describe operation claims");
        assert_eq!(
            describe
                .get("operation")
                .and_then(serde_json::Value::as_str),
            Some("describe_json")
        );
    }

    #[test]
    fn signed_capability_type_round_trips_without_unchecked_verification() {
        let c = claims();
        let wire = serde_json::to_vec(&SignedCapability {
            claims: c.clone(),
            signature: vec![0; 64],
        })
        .unwrap();
        let decoded: SignedCapability = serde_json::from_slice(&wire).unwrap();
        assert_eq!(decoded.claims, c);
        assert_eq!(decoded.signature.len(), 64);
    }

    #[test]
    fn json_task_profiles_kill_unknown_syscalls() {
        use std::os::unix::process::ExitStatusExt;

        const CHILD_MARKER: &str = "KLYN_SECCOMP_HASH_JSON_CHILD";
        if std::env::var_os(CHILD_MARKER).is_some() {
            let (broker, peer) = UnixStream::pair().expect("socketpair for pinned broker fd");
            let raw = broker.as_raw_fd();
            if raw != BROKER_FD {
                let result = unsafe { libc::dup3(raw, BROKER_FD, 0) };
                assert_eq!(result, BROKER_FD);
                drop(broker);
            }
            drop(peer);
            apply_worker_seccomp_for(BROKER_FD, WorkerOperation::HashJson)
                .expect("install strict hash JSON profile");
            let path = CString::new("/etc/passwd").expect("static path");
            unsafe {
                libc::syscall(
                    libc::SYS_openat,
                    libc::AT_FDCWD,
                    path.as_ptr(),
                    libc::O_RDONLY,
                    0,
                );
            }
            panic!("unauthorized openat returned to task code");
        }
        let output = Command::new(std::env::current_exe().expect("test executable"))
            .arg("--exact")
            .arg("landlock_seccomp::tests::json_task_profiles_kill_unknown_syscalls")
            .arg("--nocapture")
            .env(CHILD_MARKER, "1")
            .output()
            .expect("spawn isolated strict-seccomp child");
        assert!(
            !output.status.success(),
            "strict profile did not kill the child"
        );
        assert!(
            output.status.signal().is_some(),
            "strict profile did not signal-kill the child"
        );
    }

    #[test]
    fn worker_seccomp_requires_the_pinned_broker_descriptor() {
        assert!(apply_worker_seccomp(BROKER_FD + 1).is_err());
    }

    #[test]
    fn seccomp_denies_path_open_socket_connect_exec_and_fd_metadata_mutation() {
        use std::os::unix::process::ExitStatusExt;

        const CHILD_MARKER: &str = "KLYN_SECCOMP_NEGATIVE_CHILD";
        if let Ok(scenario) = std::env::var(CHILD_MARKER) {
            let (broker, peer) = UnixStream::pair().expect("socketpair for pinned broker fd");
            let raw = broker.as_raw_fd();
            if raw != BROKER_FD {
                let result = unsafe { libc::dup3(raw, BROKER_FD, 0) };
                assert_eq!(result, BROKER_FD);
                drop(broker);
            }
            drop(peer);
            apply_worker_seccomp(BROKER_FD).expect("install seccomp filter");

            match scenario.as_str() {
                "openat" => {
                    let path = CString::new("/etc/passwd").expect("static path");
                    unsafe {
                        libc::syscall(
                            libc::SYS_openat,
                            libc::AT_FDCWD,
                            path.as_ptr(),
                            libc::O_RDONLY,
                            0,
                        );
                    }
                }
                "socket" => unsafe {
                    libc::syscall(libc::SYS_socket, libc::AF_INET, libc::SOCK_STREAM, 0);
                },
                "connect" => {
                    let address = unsafe { std::mem::zeroed::<libc::sockaddr>() };
                    unsafe {
                        libc::syscall(
                            libc::SYS_connect,
                            BROKER_FD,
                            &address as *const libc::sockaddr,
                            std::mem::size_of::<libc::sockaddr>() as libc::socklen_t,
                        );
                    }
                }
                "execve" => {
                    let missing = CString::new("/__klyn_seccomp_execve_must_be_denied__")
                        .expect("static path");
                    let argv = [missing.as_ptr(), std::ptr::null()];
                    unsafe {
                        libc::syscall(
                            libc::SYS_execve,
                            missing.as_ptr(),
                            argv.as_ptr(),
                            std::ptr::null::<*const libc::c_char>(),
                        );
                    }
                }
                "fchmod" => unsafe {
                    libc::syscall(libc::SYS_fchmod, BROKER_FD, 0o777);
                },
                "dup" => unsafe {
                    libc::syscall(libc::SYS_dup, BROKER_FD);
                },
                "recvmsg-wrong-fd" => {
                    let mut message = unsafe { std::mem::zeroed::<libc::msghdr>() };
                    unsafe {
                        libc::syscall(libc::SYS_recvmsg, BROKER_FD + 1, &mut message, 0);
                    }
                }
                _ => panic!("unknown seccomp test scenario: {scenario}"),
            }
            panic!("unauthorized syscall scenario {scenario} returned to the caller");
        }

        for scenario in [
            "openat",
            "socket",
            "connect",
            "execve",
            "fchmod",
            "dup",
            "recvmsg-wrong-fd",
        ] {
            let output = Command::new(std::env::current_exe().expect("test executable"))
                .arg("--exact")
                .arg("landlock_seccomp::tests::seccomp_denies_path_open_socket_connect_exec_and_fd_metadata_mutation")
                .arg("--nocapture")
                .env(CHILD_MARKER, scenario)
                .output()
                .expect("spawn isolated seccomp negative-case child");
            assert!(
                !output.status.success(),
                "unauthorized syscall {scenario} unexpectedly returned successfully"
            );
            assert!(
                output.status.signal().is_some(),
                "unauthorized syscall {scenario} did not signal-kill the process: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[test]
    fn landlock_enforces_granted_paths_and_denies_writes_to_read_only_grants() {
        if !require_landlock_v8_or_assert_fail_closed() {
            return;
        }
        const CHILD_ROOT: &str = "KLYN_LANDLOCK_TEST_ROOT";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            let root = PathBuf::from(root);
            let mut policy = claims();
            policy.file_grants.push(crate::FileGrant {
                root_id: "workspace".into(),
                prefix: "allowed".into(),
                access: FileAccess::Read,
            });
            let roots = BTreeMap::from([("workspace".to_string(), root.clone())]);
            apply_landlock(&policy, &roots).expect("install Landlock policy");

            assert_eq!(
                std::fs::read(root.join("allowed/data.txt")).unwrap(),
                b"allowed"
            );
            assert!(
                std::fs::read(root.join("denied/data.txt")).is_err(),
                "Landlock allowed a read outside the grant"
            );
            assert!(
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(root.join("allowed/data.txt"))
                    .is_err(),
                "Landlock allowed a write under a read-only grant"
            );
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("allowed")).unwrap();
        std::fs::create_dir(dir.path().join("denied")).unwrap();
        std::fs::write(dir.path().join("allowed/data.txt"), b"allowed").unwrap();
        std::fs::write(dir.path().join("denied/data.txt"), b"denied").unwrap();

        let output = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("landlock_seccomp::tests::landlock_enforces_granted_paths_and_denies_writes_to_read_only_grants")
            .arg("--nocapture")
            .env(CHILD_ROOT, dir.path())
            .output()
            .expect("spawn isolated Landlock test process");
        assert!(
            output.status.success(),
            "Landlock negative-case child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
