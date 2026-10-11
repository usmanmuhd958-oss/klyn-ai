//! Hard-required Landlock filesystem rules and a default-deny seccomp profile.
//!
//! Install these only in a trusted, single-purpose worker bootstrap, after all
//! runtime initialization that requires direct path opens or process creation,
//! but before interpreting untrusted agent instructions.

use std::{collections::BTreeMap, os::fd::RawFd, path::PathBuf};

use landlock::{
    make_bitflags, Access, AccessFs, CompatLevel, Compatible, PathBeneath, PathFd,
    RestrictSelfAttr, RestrictionStatus, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus,
    ABI,
};
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule,
};

use crate::{validate_relative_path, CapabilityClaims, FileAccess, SandboxError, BROKER_FD};

/// Apply a hard-required ABI-v3 Landlock ruleset.
///
/// Roots must be daemon-controlled mappings from OCap root IDs to trusted
/// directory paths. Grant paths that traverse symlinks are rejected.
pub fn apply_landlock(
    claims: &CapabilityClaims,
    roots: &BTreeMap<String, PathBuf>,
) -> Result<RestrictionStatus, SandboxError> {
    claims.validate()?;
    // ABI v8 is required for all-thread Landlock enforcement. Older kernels
    // are rejected by HardRequirement; the worker never continues unsandboxed.
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
        let canonical = std::fs::canonicalize(path)?;
        if !std::fs::metadata(&canonical)?.is_dir() {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted root is not a directory: {}",
                canonical.display()
            )));
        }
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

        let access = match grant.access {
            FileAccess::Read => make_bitflags!(AccessFs::{ReadFile | ReadDir}),
            FileAccess::Write => make_bitflags!(AccessFs::{WriteFile | Truncate}),
            FileAccess::ReadWrite => {
                make_bitflags!(AccessFs::{ReadFile | ReadDir | WriteFile | Truncate})
            }
        };
        ruleset = ruleset
            .add_rule(PathBeneath::new(
                PathFd::new(&canonical)
                    .map_err(|e| SandboxError::Enforcement(format!("Landlock PathFd: {e}")))?,
                access,
            ))
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
    let allowed = [
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
        libc::SYS_fcntl,
        libc::SYS_dup,
        libc::SYS_dup2,
        libc::SYS_dup3,
        libc::SYS_poll,
        libc::SYS_ppoll,
        libc::SYS_pselect6,
        libc::SYS_select,
        libc::SYS_epoll_create1,
        libc::SYS_epoll_ctl,
        libc::SYS_epoll_wait,
        libc::SYS_epoll_pwait,
        libc::SYS_sendto,
        libc::SYS_recvfrom,
        libc::SYS_shutdown,
        libc::SYS_getsockopt,
        libc::SYS_setsockopt,
        libc::SYS_getpeername,
        libc::SYS_getsockname,
        libc::SYS_uname,
        libc::SYS_exit,
        libc::SYS_exit_group,
        libc::SYS_fsync,
        libc::SYS_fdatasync,
        libc::SYS_fchmod,
        libc::SYS_fchown,
        libc::SYS_umask,
        libc::SYS_getcwd,
    ];
    for syscall in allowed {
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
        SeccompAction::Errno(libc::EPERM as u32),
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
    apply_worker_seccomp(broker_fd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ResourceBudget, SignedCapability};
    use std::{fs::File, os::fd::AsRawFd, process::Command};

    fn claims() -> CapabilityClaims {
        CapabilityClaims {
            version: crate::OCAP_VERSION,
            token_id: "landlock-test".into(),
            subject_uid: unsafe { libc::geteuid() } as u32,
            subject_gid: unsafe { libc::getegid() } as u32,
            expires_at_unix: u64::MAX,
            file_grants: vec![],
            candidate_transaction_id: None,
            candidate_write_enabled: false,
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

    #[test]
    fn landlock_requires_supported_abi_and_all_threads() {
        let roots = BTreeMap::new();
        match apply_landlock(&claims(), &roots) {
            Ok(status) => {
                assert_eq!(status.ruleset, RulesetStatus::FullyEnforced);
                assert!(status.no_new_privs);
                assert!(status.all_threads);
            }
            // Some CI hosts still expose pre-v8 Landlock. Those hosts must
            // refuse worker execution rather than silently dropping TSYNC.
            Err(SandboxError::Enforcement(_)) => {}
            Err(error) => panic!("unexpected Landlock configuration failure: {error}"),
        }
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
    fn worker_seccomp_requires_the_pinned_broker_descriptor() {
        assert!(apply_worker_seccomp(BROKER_FD + 1).is_err());
    }

    #[test]
    fn seccomp_denies_network_sockets_and_exec_in_an_isolated_child() {
        const CHILD_ENV: &str = "KLYN_SECCOMP_ADVERSARIAL_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            let status = Command::new(std::env::current_exe().unwrap())
                .arg("--exact")
                .arg("landlock_seccomp::tests::seccomp_denies_network_sockets_and_exec_in_an_isolated_child")
                .arg("--nocapture")
                .env(CHILD_ENV, "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }

        // Pin a harmless open descriptor at FD 3 so the production policy's
        // broker-FD precondition is exercised exactly.
        let harmless_fd = File::open("/dev/null").unwrap();
        let raw_fd = harmless_fd.as_raw_fd();
        if raw_fd != BROKER_FD {
            // SAFETY: dup2 duplicates a currently open /dev/null descriptor to
            // the documented broker slot in this disposable child process.
            let duplicated = unsafe { libc::dup2(raw_fd, BROKER_FD) };
            assert_eq!(duplicated, BROKER_FD);
        }
        drop(harmless_fd);

        apply_worker_seccomp(BROKER_FD).expect("seccomp must install or fail the child test");

        for domain in [libc::AF_INET, libc::AF_UNIX] {
            // SAFETY: the syscall only attempts to create a socket. The
            // installed filter must deny it before the kernel creates one.
            let created = unsafe { libc::syscall(libc::SYS_socket, domain, libc::SOCK_STREAM, 0) };
            assert_eq!(created, -1);
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::EPERM)
            );
        }

        let executable = std::ffi::CString::new("/bin/true").unwrap();
        // SAFETY: execve is intentionally probed with null argv/envp. The
        // seccomp policy must reject the syscall with EPERM before execution.
        let executed = unsafe {
            libc::syscall(
                libc::SYS_execve,
                executable.as_ptr(),
                std::ptr::null::<*const libc::c_char>(),
                std::ptr::null::<*const libc::c_char>(),
            )
        };
        assert_eq!(executed, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::EPERM)
        );
    }
}
