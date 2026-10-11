//! Landlock and seccomp-BPF enforcement.
//!
//! Landlock constrains filesystem path operations; seccomp reduces syscall attack surface.
//! Neither is a complete sandbox alone. This implementation denies unsafe syscall families
//! and requires the worker to receive any authorized resource through the broker FD channel.

use crate::{CapabilityScope, Result, SandboxError};
use std::{
    ffi::CString,
    io,
    os::fd::{AsRawFd, BorrowedFd, FromRawFd, OwnedFd, RawFd},
};

const LANDLOCK_CREATE_RULESET_VERSION: u32 = 1;
const LANDLOCK_RULE_PATH_BENEATH: u32 = 1;
const LANDLOCK_ACCESS_FS_EXECUTE: u64 = 1 << 0;
const LANDLOCK_ACCESS_FS_WRITE_FILE: u64 = 1 << 1;
const LANDLOCK_ACCESS_FS_READ_FILE: u64 = 1 << 2;
const LANDLOCK_ACCESS_FS_READ_DIR: u64 = 1 << 3;
const LANDLOCK_ACCESS_FS_REMOVE_DIR: u64 = 1 << 4;
const LANDLOCK_ACCESS_FS_REMOVE_FILE: u64 = 1 << 5;
const LANDLOCK_ACCESS_FS_MAKE_CHAR: u64 = 1 << 6;
const LANDLOCK_ACCESS_FS_MAKE_DIR: u64 = 1 << 7;
const LANDLOCK_ACCESS_FS_MAKE_REG: u64 = 1 << 8;
const LANDLOCK_ACCESS_FS_MAKE_SOCK: u64 = 1 << 9;
const LANDLOCK_ACCESS_FS_MAKE_FIFO: u64 = 1 << 10;
const LANDLOCK_ACCESS_FS_MAKE_BLOCK: u64 = 1 << 11;
const LANDLOCK_ACCESS_FS_MAKE_SYM: u64 = 1 << 12;
const LANDLOCK_ACCESS_FS_REFER: u64 = 1 << 13;
const LANDLOCK_ACCESS_FS_TRUNCATE: u64 = 1 << 14;
const LANDLOCK_ACCESS_FS_IOCTL_DEV: u64 = 1 << 15;
const LANDLOCK_ACCESS_FS_RESOLVE_UNIX: u64 = 1 << 16;

const O_PATH_LINUX: i32 = 0x200000;
const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
const RESOLVE_NO_SYMLINKS: u64 = 0x04;
const RESOLVE_BENEATH: u64 = 0x08;

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
const SYS_LANDLOCK_CREATE_RULESET: libc::c_long = 444;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
const SYS_LANDLOCK_ADD_RULE: libc::c_long = 445;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
const SYS_LANDLOCK_RESTRICT_SELF: libc::c_long = 446;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
const SYS_OPENAT2_LINUX: libc::c_long = 437;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct RulesetAttr {
    handled_access_fs: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct PathBeneathAttr {
    allowed_access: u64,
    parent_fd: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct LandlockPathRule {
    /// Must be an already-opened directory FD resolved by the trusted launcher/broker.
    pub directory_fd: RawFd,
    pub allowed_access: u64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FsRights {
    pub read_file: bool,
    pub read_dir: bool,
    pub execute: bool,
    pub write_file: bool,
    pub create_file: bool,
    pub create_directory: bool,
    pub delete_file: bool,
    pub delete_directory: bool,
    pub create_symlink: bool,
    pub create_socket: bool,
    pub create_fifo: bool,
    pub create_device: bool,
    pub cross_directory_rename: bool,
    pub truncate: bool,
    pub device_ioctl: bool,
    pub resolve_unix_socket: bool,
}

impl FsRights {
    pub fn mask(self, abi: i32) -> u64 {
        let mut value = 0;
        if self.execute { value |= LANDLOCK_ACCESS_FS_EXECUTE; }
        if self.write_file { value |= LANDLOCK_ACCESS_FS_WRITE_FILE; }
        if self.read_file { value |= LANDLOCK_ACCESS_FS_READ_FILE; }
        if self.read_dir { value |= LANDLOCK_ACCESS_FS_READ_DIR; }
        if self.delete_directory { value |= LANDLOCK_ACCESS_FS_REMOVE_DIR; }
        if self.delete_file { value |= LANDLOCK_ACCESS_FS_REMOVE_FILE; }
        if self.create_device { value |= LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_BLOCK; }
        if self.create_directory { value |= LANDLOCK_ACCESS_FS_MAKE_DIR; }
        if self.create_file { value |= LANDLOCK_ACCESS_FS_MAKE_REG; }
        if self.create_socket { value |= LANDLOCK_ACCESS_FS_MAKE_SOCK; }
        if self.create_fifo { value |= LANDLOCK_ACCESS_FS_MAKE_FIFO; }
        if self.create_symlink { value |= LANDLOCK_ACCESS_FS_MAKE_SYM; }
        if self.cross_directory_rename && abi >= 2 { value |= LANDLOCK_ACCESS_FS_REFER; }
        if self.truncate && abi >= 3 { value |= LANDLOCK_ACCESS_FS_TRUNCATE; }
        if self.device_ioctl && abi >= 5 { value |= LANDLOCK_ACCESS_FS_IOCTL_DEV; }
        if self.resolve_unix_socket && abi >= 9 { value |= LANDLOCK_ACCESS_FS_RESOLVE_UNIX; }
        value
    }
}

pub fn filesystem_rights_for_scope(scope: &CapabilityScope) -> Result<FsRights> {
    let CapabilityScope::Filesystem { operations, .. } = scope else {
        return Err(SandboxError::Denied("Landlock filesystem mapping requires a filesystem scope".into()));
    };
    let mut rights = FsRights::default();
    for operation in operations {
        match operation.as_str() {
            "fs.read" => rights.read_file = true,
            "fs.list" => rights.read_dir = true,
            // Landlock does not constrain stat-like metadata operations consistently.
            // The broker must keep fs.metadata broker-mediated instead of trusting Landlock.
            "fs.metadata" => {}
            "fs.write" => {
                rights.write_file = true;
                rights.truncate = true;
            }
            "fs.create" => {
                rights.create_file = true;
                rights.create_directory = true;
                rights.write_file = true;
            }
            "fs.delete" => {
                rights.delete_file = true;
                rights.delete_directory = true;
            }
            _ => return Err(SandboxError::Denied("unknown filesystem operation".into())),
        }
    }
    Ok(rights)
}

pub fn query_landlock_abi() -> Result<i32> {
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("Landlock syscall numbers are unconfigured for this architecture".into()));
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        let result = unsafe {
            libc::syscall(SYS_LANDLOCK_CREATE_RULESET, std::ptr::null::<RulesetAttr>(), 0usize, LANDLOCK_CREATE_RULESET_VERSION)
        };
        if result < 0 {
            let error = io::Error::last_os_error();
            return Err(SandboxError::UnsupportedKernel(format!("Landlock unavailable or disabled: {error}")));
        }
        Ok(result as i32)
    }
}

/// Resolve a token-relative subtree from a registered root FD without following symlinks
/// or magic links. The returned O_PATH descriptor is safe to use as a Landlock rule anchor.
pub fn open_scoped_directory(root: BorrowedFd<'_>, relative_path: &str) -> Result<OwnedFd> {
    if relative_path.starts_with('/') || relative_path.contains('\0') ||
        relative_path.split('/').any(|part| part == ".." || (part == "." && relative_path != ".")) {
        return Err(SandboxError::Denied("subtree path is not canonical relative syntax".into()));
    }
    let path = if relative_path.is_empty() { "." } else { relative_path };
    let c_path = CString::new(path).map_err(|_| SandboxError::Denied("subtree path contains NUL".into()))?;
    let how = OpenHow {
        flags: (O_PATH_LINUX | libc::O_DIRECTORY | libc::O_CLOEXEC) as u64,
        mode: 0,
        resolve: RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS,
    };
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("openat2 syscall number is not configured for this architecture".into()));
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        let fd = unsafe {
            libc::syscall(SYS_OPENAT2_LINUX, root.as_raw_fd(), c_path.as_ptr(), &how, std::mem::size_of::<OpenHow>())
        };
        if fd < 0 { return Err(io::Error::last_os_error().into()); }
        Ok(unsafe { OwnedFd::from_raw_fd(fd as RawFd) })
    }
}

/// Open a file or directory beneath a registered root descriptor. Paths must be relative
/// and canonical; symlinks and magic links are denied by the kernel's openat2 resolver.
pub fn open_beneath(root: BorrowedFd<'_>, relative_path: &str, flags: i32, mode: u32) -> Result<OwnedFd> {
    if relative_path.is_empty() || relative_path.starts_with('/') || relative_path.contains('\0') ||
        relative_path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(SandboxError::Denied("resource path must be canonical relative syntax".into()));
    }
    let c_path = CString::new(relative_path).map_err(|_| SandboxError::Denied("resource path contains NUL".into()))?;
    let how = OpenHow {
        flags: (flags | libc::O_CLOEXEC) as u64,
        mode: mode as u64,
        resolve: RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS,
    };
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("openat2 syscall number is not configured for this architecture".into()));
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        let fd = unsafe {
            libc::syscall(SYS_OPENAT2_LINUX, root.as_raw_fd(), c_path.as_ptr(), &how, std::mem::size_of::<OpenHow>())
        };
        if fd < 0 { return Err(io::Error::last_os_error().into()); }
        Ok(unsafe { OwnedFd::from_raw_fd(fd as RawFd) })
    }
}

/// Enforce a deny-by-default filesystem policy. Every intended readable/writable baseline
/// path must be an explicit LandlockPathRule; an empty rule list denies all handled FS rights.
pub fn apply_landlock_rules(rules: &[LandlockPathRule]) -> Result<i32> {
    let abi = query_landlock_abi()?;
    let handled = handled_fs_access(abi);
    if rules.iter().any(|rule| rule.directory_fd < 0 || rule.allowed_access & !handled != 0) {
        return Err(SandboxError::Denied("Landlock rule contains invalid FD or unsupported access rights".into()));
    }
    if abi < 3 && rules.iter().any(|rule| rule.allowed_access & LANDLOCK_ACCESS_FS_WRITE_FILE != 0) {
        return Err(SandboxError::UnsupportedKernel("write-capable scopes require Landlock ABI v3+ for truncate mediation".into()));
    }

    let attr = RulesetAttr { handled_access_fs: handled };
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("Landlock syscall number is not configured for this architecture".into()));
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        let ruleset_fd = unsafe {
            libc::syscall(SYS_LANDLOCK_CREATE_RULESET, &attr, std::mem::size_of::<RulesetAttr>(), 0u32)
        };
        if ruleset_fd < 0 { return Err(io::Error::last_os_error().into()); }
        let ruleset = unsafe { OwnedFd::from_raw_fd(ruleset_fd as RawFd) };
        for rule in rules {
            let beneath = PathBeneathAttr { allowed_access: rule.allowed_access, parent_fd: rule.directory_fd };
            let result = unsafe {
                libc::syscall(SYS_LANDLOCK_ADD_RULE, ruleset.as_raw_fd(), LANDLOCK_RULE_PATH_BENEATH, &beneath, 0u32)
            };
            if result < 0 { return Err(io::Error::last_os_error().into()); }
        }
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        if unsafe { libc::syscall(SYS_LANDLOCK_RESTRICT_SELF, ruleset.as_raw_fd(), 0u32) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(abi)
    }
}

pub fn scope_landlock_rule(
    root: BorrowedFd<'_>,
    scope: &CapabilityScope,
) -> Result<(OwnedFd, LandlockPathRule)> {
    let rights = filesystem_rights_for_scope(scope)?;
    let (prefix, _) = match scope {
        CapabilityScope::Filesystem { relative_path_prefix, max_bytes_per_invocation, .. } => (relative_path_prefix.as_str(), *max_bytes_per_invocation),
        _ => return Err(SandboxError::Denied("filesystem scope required".into())),
    };
    let directory = open_scoped_directory(root, prefix)?;
    let abi = query_landlock_abi()?;
    let mask = rights.mask(abi);
    if rights.truncate && abi < 3 {
        return Err(SandboxError::UnsupportedKernel("Landlock ABI v3+ required to enforce write/truncate restrictions".into()));
    }
    let rule = LandlockPathRule { directory_fd: directory.as_raw_fd(), allowed_access: mask };
    Ok((directory, rule))
}

fn handled_fs_access(abi: i32) -> u64 {
    let bits = match abi {
        1 => 13,
        2 => 14,
        3 | 4 => 15,
        5..=8 => 16,
        _ => 17,
    };
    (1u64 << bits) - 1
}

const BPF_LD_W_ABS: u16 = 0x20;
const BPF_JMP_JEQ_K: u16 = 0x15;
const BPF_RET_K: u16 = 0x06;
const SECCOMP_RET_KILL_PROCESS: u32 = 0x8000_0000;
const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;
const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
const SECCOMP_ARCH_OFFSET: u32 = 4;
const SECCOMP_NR_OFFSET: u32 = 0;

#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH_NATIVE: u32 = 0xc000_003e;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH_NATIVE: u32 = 0xc000_00b7;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SockFilter {
    pub code: u16,
    pub jt: u8,
    pub jf: u8,
    pub k: u32,
}

#[repr(C)]
struct SockFprog {
    len: u16,
    filter: *const SockFilter,
}

fn stmt(code: u16, k: u32) -> SockFilter { SockFilter { code, jt: 0, jf: 0, k } }
fn jump(code: u16, k: u32, jt: u8, jf: u8) -> SockFilter { SockFilter { code, jt, jf, k } }

/// Returns syscalls that the agent must not perform directly. Brokered file/socket/process
/// authority arrives as FDs over a pre-opened Unix socket. The profile blocks raw open,
/// network creation/connect, process execution/creation, namespace manipulation, mount,
/// BPF/perf, userfaultfd, io_uring, and common filesystem mutations.
pub fn denied_syscalls() -> Result<Vec<u32>> {
    #[cfg(target_arch = "x86_64")]
    let values: &[u32] = &[
        2, 257, 437, 85, 41, 53, 42, 49, 50, 43, 288, 59, 322, 57, 58, 56, 435,
        101, 165, 166, 155, 161, 272, 308, 321, 298, 250, 248, 249, 323, 425, 426, 427,
        87, 263, 82, 264, 316, 83, 258, 84, 86, 265, 88, 266, 133, 259, 90, 91, 268,
        92, 93, 260, 76, 77,
    ];
    #[cfg(target_arch = "aarch64")]
    let values: &[u32] = &[
        56, 437, 198, 199, 203, 200, 201, 202, 242, 221, 281, 220, 435,
        117, 40, 39, 41, 97, 268, 280, 241, 219, 217, 218, 282, 425, 426, 427,
        35, 38, 276, 34, 37, 36, 33, 53, 54, 46,
    ];
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("seccomp syscall table is not configured for this architecture".into()));
    #[allow(unreachable_code)]
    Ok(values.to_vec())
}

/// Minimal runtime syscall allow-list. The default action is EPERM, so newly added
/// kernel syscalls are denied unless reviewed and added here. This profile is designed
/// for a pre-initialized single-thread worker that communicates through inherited FDs.
pub fn allowed_syscalls() -> Result<Vec<u32>> {
    #[cfg(target_arch = "x86_64")]
    let values: &[u32] = &[
        0, 1, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 23, 24, 25, 28,
        35, 39, 60, 63, 72, 96, 102, 104, 107, 108, 131, 158, 186, 202, 204, 218,
        219, 228, 230, 231, 232, 233, 270, 271, 281, 283, 286, 287, 290, 291, 302,
        318, 334, 47,
    ];
    #[cfg(target_arch = "aarch64")]
    let values: &[u32] = &[
        19, 20, 21, 22, 23, 24, 25, 57, 62, 63, 64, 65, 66, 67, 72, 73, 80,
        85, 86, 87, 93, 94, 96, 98, 99, 101, 113, 115, 124, 128, 132, 134, 135,
        139, 160, 172, 174, 175, 176, 177, 178, 212, 214, 215, 216, 222,
        226, 233, 261, 278, 293, 441,
    ];
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("seccomp allow-list is not configured for this architecture".into()));
    #[allow(unreachable_code)]
    Ok(values.to_vec())
}

/// Build an explicit-allow seccomp program. Architecture mismatch kills the process;
/// known-safe syscalls return ALLOW; every other syscall, including new kernel syscalls,
/// returns EPERM. This does not delegate authority merely by allowing a syscall number;
/// inherited FDs still need to be capability-scoped by the launcher.
pub fn seccomp_program() -> Result<Vec<SockFilter>> {
    let allowed = allowed_syscalls()?;
    let mut program = Vec::with_capacity(5 + allowed.len() * 2);
    program.push(stmt(BPF_LD_W_ABS, SECCOMP_ARCH_OFFSET));
    program.push(jump(BPF_JMP_JEQ_K, AUDIT_ARCH_NATIVE, 1, 0));
    program.push(stmt(BPF_RET_K, SECCOMP_RET_KILL_PROCESS));
    program.push(stmt(BPF_LD_W_ABS, SECCOMP_NR_OFFSET));
    for syscall in allowed {
        program.push(jump(BPF_JMP_JEQ_K, syscall, 0, 1));
        program.push(stmt(BPF_RET_K, SECCOMP_RET_ALLOW));
    }
    program.push(stmt(BPF_RET_K, SECCOMP_RET_ERRNO | (libc::EPERM as u32)));
    if program.len() > u16::MAX as usize {
        return Err(SandboxError::Protocol("seccomp program exceeds kernel instruction limit".into()));
    }
    Ok(program)
}

pub fn install_agent_seccomp() -> Result<()> {
    let program = seccomp_program()?;
    let prog = SockFprog { len: program.len() as u16, filter: program.as_ptr() };
    if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    // SAFETY: program storage remains alive until prctl returns; the kernel copies the
    // BPF instructions when installing the filter.
    if unsafe { libc::prctl(libc::PR_SET_SECCOMP, libc::SECCOMP_MODE_FILTER, &prog) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seccomp_program_has_arch_kill_and_default_deny() {
        let program = seccomp_program().unwrap();
        assert_eq!(program[0].code, BPF_LD_W_ABS);
        assert_eq!(program[0].k, SECCOMP_ARCH_OFFSET);
        assert_eq!(program[2].k, SECCOMP_RET_KILL_PROCESS);
        assert_eq!(program.last().unwrap().k, SECCOMP_RET_ERRNO | (libc::EPERM as u32));
    }

    #[test]
    fn explicit_allow_list_excludes_path_open_socket_and_execution() {
        let allowed = allowed_syscalls().unwrap();
        #[cfg(target_arch = "x86_64")]
        {
            assert!(!allowed.contains(&2));   // open
            assert!(!allowed.contains(&257)); // openat
            assert!(!allowed.contains(&41));  // socket
            assert!(!allowed.contains(&59));  // execve
        }
        #[cfg(target_arch = "aarch64")]
        {
            assert!(!allowed.contains(&56));  // openat
            assert!(!allowed.contains(&198)); // socket
            assert!(!allowed.contains(&221)); // execve
        }
    }

    #[test]
    fn open_socket_and_exec_are_in_the_denied_syscall_set() {
        let denied = denied_syscalls().unwrap();
        #[cfg(target_arch = "x86_64")]
        {
            assert!(denied.contains(&2));   // open
            assert!(denied.contains(&41));  // socket
            assert!(denied.contains(&59));  // execve
        }
        #[cfg(target_arch = "aarch64")]
        {
            assert!(denied.contains(&56));  // openat
            assert!(denied.contains(&198)); // socket
            assert!(denied.contains(&221)); // execve
        }
    }

    #[test]
    fn landlock_mapping_refuses_non_filesystem_scope() {
        let scope = CapabilityScope::Network {
            handle_id: "net-handle-1".into(), resource_id: "net-resource-1".into(),
            operations: vec!["net.connect".into()], hosts: vec!["example.com".into()],
            ports: vec![crate::PortRange { first: 443, last: 443 }], max_bytes_per_invocation: 1024,
        };
        assert!(filesystem_rights_for_scope(&scope).is_err());
    }

    #[test]
    fn filesystem_scope_maps_only_requested_rights() {
        let scope = CapabilityScope::Filesystem {
            handle_id: "fs-handle-1".into(), resource_id: "workspace-1".into(),
            operations: vec!["fs.read".into(), "fs.list".into()],
            relative_path_prefix: "repo/src".into(), max_bytes_per_invocation: 4096,
        };
        let rights = filesystem_rights_for_scope(&scope).unwrap().mask(3);
        assert!(rights & LANDLOCK_ACCESS_FS_READ_FILE != 0);
        assert!(rights & LANDLOCK_ACCESS_FS_READ_DIR != 0);
        assert_eq!(rights & LANDLOCK_ACCESS_FS_WRITE_FILE, 0);
    }
}
