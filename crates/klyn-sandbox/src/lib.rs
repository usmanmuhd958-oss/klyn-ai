//! Linux-only kernel enforcement primitives for KLYN OS.
//!
//! Security contract:
//! * A trusted launcher must hold the child at a start gate until it has joined
//!   its cgroup.
//! * Only a trusted KLYN worker bootstrap may be launched. It must connect to
//!   the broker and call landlock_seccomp::enforce_worker before running
//!   capability-controlled or model-generated work.
//! * Every required kernel enforcement failure is fatal to the worker. Callers
//!   must never downgrade to an unsandboxed execution path.

#[cfg(not(target_os = "linux"))]
compile_error!("klyn-sandbox currently requires Linux kernel isolation primitives");

pub mod broker;
pub mod cgroup;
pub mod landlock_seccomp;
pub mod manifest;
pub mod start_gate;
pub mod supervisor;
pub mod task;
pub mod worker_bootstrap;

use std::{
    collections::BTreeSet,
    ffi::{CString, OsStr},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt},
        },
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const OCAP_VERSION: u32 = 1;
pub const MAX_BROKER_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_SANDBOX_PATH_BYTES: usize = 4096;
pub const MAX_SANDBOX_PATH_COMPONENT_BYTES: usize = 255;
pub const MAX_IO_DEVICE_LIMITS: usize = 64;
pub const BROKER_FD: i32 = 3;
pub const MANIFEST_FD: i32 = 4;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("invalid sandbox configuration: {0}")]
    InvalidConfig(String),
    #[error("kernel enforcement failed: {0}")]
    Enforcement(String),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SignedCapability {
    pub claims: CapabilityClaims,
    /// Ed25519 signature over serde_json::to_vec(claims).
    /// Struct field order is part of this v1 wire format; map fields are avoided.
    pub signature: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityClaims {
    pub version: u32,
    pub token_id: String,
    pub subject_uid: u32,
    pub subject_gid: u32,
    pub expires_at_unix: u64,
    pub file_grants: Vec<FileGrant>,
    /// Network grants use literal socket addresses, never hostnames. This avoids
    /// DNS rebinding and makes the destination authorized by the signature exact.
    pub network_grants: Vec<NetworkGrant>,
    pub budget: ResourceBudget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileGrant {
    pub root_id: String,
    /// Relative POSIX path beneath the trusted root. Empty means the root itself.
    pub prefix: String,
    pub access: FileAccess,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileAccess {
    Read,
    Write,
    ReadWrite,
}

impl FileAccess {
    pub fn permits(self, requested: Self) -> bool {
        matches!(
            (self, requested),
            (Self::Read, Self::Read)
                | (Self::Write, Self::Write)
                | (Self::ReadWrite, Self::Read)
                | (Self::ReadWrite, Self::Write)
                | (Self::ReadWrite, Self::ReadWrite)
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NetworkGrant {
    /// Literal IPv4:port or [IPv6]:port; parsed and compared structurally.
    pub address: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResourceBudget {
    pub memory_max_bytes: u64,
    pub cpu_quota_micros: u64,
    pub cpu_period_micros: u64,
    pub pids_max: u32,
    #[serde(default)]
    pub io_limits: Vec<IoDeviceLimit>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IoDeviceLimit {
    pub major: u32,
    pub minor: u32,
    pub rbps: Option<u64>,
    pub wbps: Option<u64>,
    pub riops: Option<u64>,
    pub wiops: Option<u64>,
}

impl ResourceBudget {
    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.memory_max_bytes == 0 {
            return Err(SandboxError::InvalidConfig(
                "memory_max_bytes must be greater than zero".into(),
            ));
        }
        if self.cpu_quota_micros == 0 || !(1_000..=1_000_000).contains(&self.cpu_period_micros) {
            return Err(SandboxError::InvalidConfig(
                "cpu quota must be positive and cpu period must be in 1000..=1000000 microseconds"
                    .into(),
            ));
        }
        if self.pids_max == 0 {
            return Err(SandboxError::InvalidConfig(
                "pids_max must be greater than zero".into(),
            ));
        }
        if self.io_limits.len() > MAX_IO_DEVICE_LIMITS {
            return Err(SandboxError::InvalidConfig(format!(
                "I/O budget may contain at most {MAX_IO_DEVICE_LIMITS} devices"
            )));
        }
        let mut devices = BTreeSet::new();
        for limit in &self.io_limits {
            if limit.major == 0 && limit.minor == 0 {
                return Err(SandboxError::InvalidConfig(
                    "I/O device 0:0 is not a valid block-device limit target".into(),
                ));
            }
            if limit.rbps == Some(0)
                || limit.wbps == Some(0)
                || limit.riops == Some(0)
                || limit.wiops == Some(0)
            {
                return Err(SandboxError::InvalidConfig(
                    "I/O limits must be positive or omitted".into(),
                ));
            }
            if limit.rbps.is_none()
                && limit.wbps.is_none()
                && limit.riops.is_none()
                && limit.wiops.is_none()
            {
                return Err(SandboxError::InvalidConfig(
                    "each I/O device limit must specify at least one limit".into(),
                ));
            }
            if !devices.insert((limit.major, limit.minor)) {
                return Err(SandboxError::InvalidConfig(
                    "duplicate device in I/O limits".into(),
                ));
            }
        }
        Ok(())
    }
}

impl CapabilityClaims {
    pub fn validate(&self) -> Result<(), SandboxError> {
        if self.version != OCAP_VERSION {
            return Err(SandboxError::InvalidConfig(format!(
                "unsupported OCap version {}",
                self.version
            )));
        }
        if self.token_id.is_empty() || self.token_id.len() > 256 {
            return Err(SandboxError::InvalidConfig(
                "token_id must contain 1..=256 bytes".into(),
            ));
        }
        if self.subject_uid == 0 {
            return Err(SandboxError::InvalidConfig(
                "root UID is not permitted for agent workers".into(),
            ));
        }
        self.budget.validate()?;

        let mut file_scopes = BTreeSet::new();
        for grant in &self.file_grants {
            if grant.root_id.is_empty() || grant.root_id.len() > 128 {
                return Err(SandboxError::InvalidConfig(
                    "file grant root_id must contain 1..=128 bytes".into(),
                ));
            }
            validate_relative_path(&grant.prefix, true)?;
            // Duplicate scopes with different access modes are ambiguous and
            // can merge into broader Landlock rules. Use one explicit mode per scope.
            if !file_scopes.insert((grant.root_id.as_str(), grant.prefix.as_str())) {
                return Err(SandboxError::InvalidConfig(
                    "duplicate filesystem grant scope; combine access into one explicit grant"
                        .into(),
                ));
            }
        }
        let mut network_scopes = BTreeSet::new();
        for grant in &self.network_grants {
            let address = grant.address.parse::<std::net::SocketAddr>().map_err(|_| {
                SandboxError::InvalidConfig(format!(
                    "network grant must be a literal socket address: {}",
                    grant.address
                ))
            })?;
            if !network_scopes.insert(address) {
                return Err(SandboxError::InvalidConfig(
                    "duplicate network destination in capability".into(),
                ));
            }
        }
        Ok(())
    }
}

/// Validate an untrusted relative path before either prefix checks or openat2.
/// Symlinks are rejected independently by openat2 with RESOLVE_NO_SYMLINKS.
pub fn validate_relative_path(path: &str, allow_empty: bool) -> Result<(), SandboxError> {
    if path.is_empty() {
        return if allow_empty {
            Ok(())
        } else {
            Err(SandboxError::InvalidConfig(
                "empty relative path is not permitted".into(),
            ))
        };
    }
    if path.len() > MAX_SANDBOX_PATH_BYTES {
        return Err(SandboxError::InvalidConfig(format!(
            "path exceeds {MAX_SANDBOX_PATH_BYTES} bytes"
        )));
    }
    if path.starts_with('/') || path.contains('\0') || path.contains('\\') {
        return Err(SandboxError::InvalidConfig(
            "path must be a relative POSIX path without NUL or backslash".into(),
        ));
    }
    for component in path.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(SandboxError::InvalidConfig(
                "path contains an empty, dot, or parent component".into(),
            ));
        }
        if component.len() > MAX_SANDBOX_PATH_COMPONENT_BYTES {
            return Err(SandboxError::InvalidConfig(format!(
                "path component exceeds {MAX_SANDBOX_PATH_COMPONENT_BYTES} bytes"
            )));
        }
    }
    Ok(())
}

/// Resolve and validate a daemon-configured filesystem root.
pub fn validate_trusted_root(path: impl AsRef<Path>) -> Result<PathBuf, SandboxError> {
    let canonical = fs::canonicalize(path.as_ref())?;
    // Open the final directory without following symlinks. Do all object-level
    // checks against this pinned descriptor instead of re-resolving the path.
    let pinned = open_path_no_symlinks(&canonical, true)?;
    let metadata = pinned.metadata()?;
    if !metadata.is_dir() || metadata.mode() & 0o022 != 0 {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted root is not a protected directory (must not be group/world writable): {}",
            canonical.display()
        )));
    }

    // Prevent an untrusted writable ancestor from replacing the path between
    // validation and descriptor acquisition. Sticky directories such as /tmp
    // are permitted because the directory entry can only be renamed by its
    // owner or the parent owner; the root itself remains non-group/world-writable.
    let mut current = canonical.parent();
    while let Some(parent) = current {
        let parent_meta = fs::metadata(parent)?;
        if !parent_meta.is_dir()
            || (parent_meta.mode() & 0o022 != 0 && parent_meta.mode() & 0o1000 == 0)
        {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted root has an unsafe writable ancestor: {}",
                parent.display()
            )));
        }
        if parent == Path::new("/") {
            break;
        }
        current = parent.parent();
    }

    // Never let a capability root expose the host root or virtual kernel APIs.
    // Path::starts_with is component-aware (so /dev-workspace is not /dev).
    let protected = [
        Path::new("/proc"),
        Path::new("/sys"),
        Path::new("/dev"),
        Path::new("/run"),
    ];
    if canonical == Path::new("/") || protected.iter().any(|prefix| canonical.starts_with(prefix)) {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted root points at a protected filesystem tree: {}",
            canonical.display()
        )));
    }

    // Bind mounts can make procfs/sysfs/cgroups visible under an innocent-looking
    // path. Reject their filesystem identities as well as their lexical paths.
    const FORBIDDEN_FS_TYPES: &[u64] = &[
        0x0000_9fa0, // PROC_SUPER_MAGIC
        0x6265_6572, // SYSFS_MAGIC
        0x0000_1cd1, // DEVPTS_SUPER_MAGIC
        0x0027_e0eb, // CGROUP_SUPER_MAGIC
        0x6367_7270, // CGROUP2_SUPER_MAGIC
        0x6462_6720, // DEBUGFS_MAGIC
        0x7363_6673, // SECURITYFS_MAGIC
        0x7472_6163, // TRACEFS_MAGIC
        0xcafe_4a11, // BPF_FS_MAGIC
        0x6e73_6673, // NSFS_MAGIC
        0x4249_4e4d, // BINFMTFS_MAGIC
        0x6264_6576, // BDEVFS_MAGIC
        0x6c6f_6f70, // BINDERFS_SUPER_MAGIC
        0x6265_6570, // CONFIGFS_MAGIC
        0x0000_0187, // AUTOFS_SUPER_MAGIC
    ];
    let mut fs_stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::fstatfs(pinned.as_raw_fd(), fs_stat.as_mut_ptr()) } != 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    let fs_stat = unsafe { fs_stat.assume_init() };
    if FORBIDDEN_FS_TYPES.contains(&(fs_stat.f_type as u64)) {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted root is on a protected virtual filesystem: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

/// Open a canonical absolute path as an O_PATH descriptor without following
/// symlinks or magic links at any component. The descriptor pins the object
/// used by Landlock rules or the broker's root handle, eliminating a
/// canonicalize-then-open path replacement race.
pub(crate) fn open_path_no_symlinks(
    path: impl AsRef<Path>,
    directory_only: bool,
) -> Result<File, SandboxError> {
    const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
    const RESOLVE_NO_SYMLINKS: u64 = 0x04;
    const RESOLVE_BENEATH: u64 = 0x08;

    let path = path.as_ref();
    if !path.is_absolute() || path == Path::new("/") {
        return Err(SandboxError::InvalidConfig(
            "pinned filesystem path must be a non-root absolute path".into(),
        ));
    }
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    }) {
        return Err(SandboxError::InvalidConfig(
            "pinned filesystem path must be canonical".into(),
        ));
    }

    let relative = path.strip_prefix("/").map_err(|_| {
        SandboxError::InvalidConfig("pinned filesystem path is not beneath /".into())
    })?;
    let relative = CString::new(relative.as_os_str().as_bytes())
        .map_err(|_| SandboxError::InvalidConfig("NUL in pinned filesystem path".into()))?;
    let root = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open("/")?;

    #[repr(C)]
    struct OpenHow {
        flags: u64,
        mode: u64,
        resolve: u64,
    }
    let flags = libc::O_PATH | libc::O_CLOEXEC | if directory_only { libc::O_DIRECTORY } else { 0 };
    let how = OpenHow {
        flags: flags as u64,
        mode: 0,
        resolve: RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS,
    };
    let fd = unsafe {
        libc::syscall(
            libc::SYS_openat2,
            root.as_raw_fd(),
            relative.as_ptr(),
            &how as *const OpenHow,
            std::mem::size_of::<OpenHow>(),
        ) as libc::c_int
    };
    if fd < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

/// Component-aware subtree check (e.g. src2 is not beneath src).
pub fn path_is_within_grant(requested: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return validate_relative_path(requested, false).is_ok();
    }
    requested == prefix
        || requested
            .strip_prefix(prefix)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

/// A delegated cgroup-v2 subtree. The parent must already expose cpu, memory,
/// pids and (when requested) io controllers to this delegated subtree.
pub struct CgroupV2 {
    path: PathBuf,
}

impl CgroupV2 {
    pub fn create(
        delegated_root: impl AsRef<Path>,
        id: &str,
        budget: &ResourceBudget,
    ) -> Result<Self, SandboxError> {
        budget.validate()?;
        validate_cgroup_id(id)?;
        let root = fs::canonicalize(delegated_root)?;
        if !root.join("cgroup.controllers").is_file() {
            return Err(SandboxError::InvalidConfig(
                "delegated root is not a cgroup-v2 directory".into(),
            ));
        }
        let available = fs::read_to_string(root.join("cgroup.controllers"))?;
        let enabled = fs::read_to_string(root.join("cgroup.subtree_control"))?;
        let mut required_controllers = vec!["cpu", "memory", "pids"];
        if !budget.io_limits.is_empty() {
            required_controllers.push("io");
        }
        for controller in required_controllers {
            if !available.split_whitespace().any(|c| c == controller) {
                return Err(SandboxError::InvalidConfig(format!(
                    "required cgroup-v2 controller is unavailable: {controller}"
                )));
            }
            if !enabled.split_whitespace().any(|c| c == controller) {
                return Err(SandboxError::Enforcement(format!(
                    "required cgroup-v2 controller is not enabled in cgroup.subtree_control: {controller}"
                )));
            }
        }
        if fs::read_to_string(root.join("cgroup.type"))?.trim() != "domain" {
            return Err(SandboxError::InvalidConfig(
                "sandbox cgroups require a domain cgroup subtree".into(),
            ));
        }
        if !root.join("cgroup.kill").exists() {
            return Err(SandboxError::Enforcement(
                "cgroup.kill is unavailable; refusing a cgroup without reliable kill support"
                    .into(),
            ));
        }

        let path = root.join(id);
        fs::create_dir(&path)?;
        let result = (|| -> Result<(), SandboxError> {
            write_control(
                &path.join("memory.max"),
                &budget.memory_max_bytes.to_string(),
            )?;
            write_control(&path.join("memory.oom.group"), "1")?;
            write_control(&path.join("memory.swap.max"), "0")?;
            write_control(
                &path.join("cpu.max"),
                &format!("{} {}", budget.cpu_quota_micros, budget.cpu_period_micros),
            )?;
            write_control(&path.join("pids.max"), &budget.pids_max.to_string())?;

            for limit in &budget.io_limits {
                let line = format!(
                    "{}:{} rbps={} wbps={} riops={} wiops={}",
                    limit.major,
                    limit.minor,
                    limit.rbps.map_or_else(|| "max".into(), |v| v.to_string()),
                    limit.wbps.map_or_else(|| "max".into(), |v| v.to_string()),
                    limit.riops.map_or_else(|| "max".into(), |v| v.to_string()),
                    limit.wiops.map_or_else(|| "max".into(), |v| v.to_string()),
                );
                write_control(&path.join("io.max"), &line)?;
            }
            if !path.join("cgroup.kill").exists() {
                return Err(SandboxError::Enforcement(
                    "new cgroup has no cgroup.kill control; refusing incomplete lifecycle cleanup"
                        .into(),
                ));
            }
            verify_budget_controls(&path, budget)?;
            Ok(())
        })();

        if let Err(error) = result {
            let _ = fs::remove_dir(&path);
            return Err(error);
        }
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Attach only while the child is blocked on a launcher start gate. Calling
    /// this after untrusted work starts creates a resource-limit race.
    pub fn attach_pid(&self, pid: u32) -> Result<(), SandboxError> {
        if pid == 0 {
            return Err(SandboxError::InvalidConfig("PID zero is invalid".into()));
        }
        write_control(&self.path.join("cgroup.procs"), &pid.to_string())?;
        Ok(())
    }

    pub fn kill_all(&self) -> Result<(), SandboxError> {
        let path = self.path.join("cgroup.kill");
        if !path.exists() {
            return Err(SandboxError::Enforcement(
                "cgroup.kill is unavailable; refusing an incomplete group kill".into(),
            ));
        }
        write_control(&path, "1")?;
        Ok(())
    }

    /// Kill every task in the sandbox and wait until the kernel reports the
    /// cgroup empty. Timeout or an unavailable control is an enforcement error.
    pub fn terminate_and_wait(&self, timeout: Duration) -> Result<(), SandboxError> {
        self.kill_all()?;
        let deadline = Instant::now() + timeout;
        let events_path = self.path.join("cgroup.events");
        loop {
            let events = fs::read_to_string(&events_path)?;
            if events.lines().any(|line| line.trim() == "populated 0") {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(SandboxError::Enforcement(
                    "sandbox cgroup remained populated after kill timeout".into(),
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for CgroupV2 {
    fn drop(&mut self) {
        // Dropping the supervisor handle must not leave a runaway worker behind.
        // Use a bounded wait so directory removal does not race asynchronous
        // task teardown. Explicit terminate_and_wait remains preferred because
        // Drop cannot report cleanup errors to the caller.
        let _ = self.terminate_and_wait(Duration::from_secs(3));
        let _ = fs::remove_dir(&self.path);
    }
}

/// Verify this process is in a dedicated cgroup-v2 child with limits no weaker
/// than the signed capability. Called before Landlock/seccomp block path reads.
pub(crate) fn verify_current_cgroup_budget(budget: &ResourceBudget) -> Result<(), SandboxError> {
    budget.validate()?;
    let proc_cgroup = fs::read_to_string("/proc/self/cgroup")?;
    let path = resolve_current_cgroup_path(&proc_cgroup, Path::new("/sys/fs/cgroup"))?;
    if fs::read_to_string(path.join("cgroup.type"))?.trim() != "domain"
        || !path.join("cgroup.kill").exists()
    {
        return Err(SandboxError::Enforcement(
            "worker is not in a killable domain cgroup-v2 sandbox".into(),
        ));
    }
    verify_budget_controls(&path, budget)
}

fn resolve_current_cgroup_path(
    proc_cgroup: &str,
    cgroup_mount: &Path,
) -> Result<PathBuf, SandboxError> {
    let mut unified = None;
    for line in proc_cgroup.lines() {
        if let Some(path) = line.strip_prefix("0::") {
            if unified.replace(path).is_some() {
                return Err(SandboxError::Enforcement(
                    "duplicate unified cgroup entry in /proc/self/cgroup".into(),
                ));
            }
        }
    }
    let path = unified.ok_or_else(|| {
        SandboxError::Enforcement(
            "worker has no unified cgroup-v2 membership in /proc/self/cgroup".into(),
        )
    })?;
    let relative = Path::new(path)
        .strip_prefix("/")
        .map_err(|_| SandboxError::Enforcement("invalid unified cgroup path".into()))?;
    if relative.as_os_str().is_empty()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        })
    {
        return Err(SandboxError::Enforcement(
            "worker must be in a dedicated non-root cgroup-v2 child".into(),
        ));
    }

    let mount = fs::canonicalize(cgroup_mount)?;
    let requested = mount.join(relative);
    let canonical = fs::canonicalize(&requested)?;
    if canonical != requested || !canonical.starts_with(&mount) {
        return Err(SandboxError::Enforcement(
            "worker cgroup path escapes the mounted cgroup-v2 hierarchy".into(),
        ));
    }
    Ok(canonical)
}

pub(crate) fn verify_budget_controls(
    path: &Path,
    budget: &ResourceBudget,
) -> Result<(), SandboxError> {
    fn read_numeric(path: &Path, label: &str) -> Result<u64, SandboxError> {
        let value = fs::read_to_string(path)?;
        value.trim().parse::<u64>().map_err(|_| {
            SandboxError::Enforcement(format!(
                "kernel did not report a finite numeric {label} limit"
            ))
        })
    }

    let effective_memory = read_numeric(&path.join("memory.max"), "memory.max")?;
    if effective_memory == 0 || effective_memory > budget.memory_max_bytes {
        return Err(SandboxError::Enforcement(
            "effective memory.max exceeds the requested resource budget".into(),
        ));
    }
    if read_numeric(&path.join("memory.swap.max"), "memory.swap.max")? != 0 {
        return Err(SandboxError::Enforcement(
            "swap is not disabled for the sandbox cgroup".into(),
        ));
    }
    if fs::read_to_string(path.join("memory.oom.group"))?.trim() != "1" {
        return Err(SandboxError::Enforcement(
            "memory.oom.group is not enabled for the sandbox cgroup".into(),
        ));
    }
    let cpu = fs::read_to_string(path.join("cpu.max"))?;
    let cpu: Vec<_> = cpu.split_whitespace().collect();
    if cpu.len() != 2
        || cpu[0].parse::<u64>().ok() != Some(budget.cpu_quota_micros)
        || cpu[1].parse::<u64>().ok() != Some(budget.cpu_period_micros)
    {
        return Err(SandboxError::Enforcement(
            "effective cpu.max differs from the requested resource budget".into(),
        ));
    }
    if read_numeric(&path.join("pids.max"), "pids.max")? != u64::from(budget.pids_max) {
        return Err(SandboxError::Enforcement(
            "effective pids.max differs from the requested resource budget".into(),
        ));
    }

    if !budget.io_limits.is_empty() {
        let contents = fs::read_to_string(path.join("io.max"))?;
        for limit in &budget.io_limits {
            let device = format!("{}:{}", limit.major, limit.minor);
            let line = contents
                .lines()
                .find(|line| line.split_whitespace().next() == Some(device.as_str()))
                .ok_or_else(|| {
                    SandboxError::Enforcement(format!(
                        "kernel did not report the requested I/O device limit: {device}"
                    ))
                })?;
            for (key, expected) in [
                (
                    "rbps",
                    limit.rbps.map_or_else(|| "max".into(), |v| v.to_string()),
                ),
                (
                    "wbps",
                    limit.wbps.map_or_else(|| "max".into(), |v| v.to_string()),
                ),
                (
                    "riops",
                    limit.riops.map_or_else(|| "max".into(), |v| v.to_string()),
                ),
                (
                    "wiops",
                    limit.wiops.map_or_else(|| "max".into(), |v| v.to_string()),
                ),
            ] {
                let actual = line
                    .split_whitespace()
                    .find_map(|field| field.strip_prefix(&format!("{key}=")));
                if actual != Some(expected.as_str()) {
                    return Err(SandboxError::Enforcement(format!(
                        "effective io.max {key} limit differs for device {device}"
                    )));
                }
            }
        }
    }
    Ok(())
}

fn write_control(path: &Path, value: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).open(path)?;
    file.write_all(value.as_bytes())?;
    file.flush()
}

fn validate_cgroup_id(id: &str) -> Result<(), SandboxError> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(SandboxError::InvalidConfig(
            "cgroup id must be 1..=64 ASCII alphanumeric, '-' or '_' bytes".into(),
        ));
    }
    Ok(())
}

/// Verify that a configured worker executable is root-owned, non-writable,
/// and stored beneath directories that untrusted worker identities cannot alter.
pub fn validate_trusted_executable(path: impl AsRef<Path>) -> Result<PathBuf, SandboxError> {
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    let mode = metadata.mode();
    if canonical.file_name() != Some(OsStr::new("klyn-worker")) {
        return Err(SandboxError::InvalidConfig(
            "trusted executable must be named klyn-worker".into(),
        ));
    }

    let mut executable = File::open(&canonical)?;
    let mut elf_magic = [0u8; 4];
    executable.read_exact(&mut elf_magic).map_err(|_| {
        SandboxError::InvalidConfig("trusted worker executable is truncated".into())
    })?;
    if elf_magic != *b"\x7fELF" {
        return Err(SandboxError::InvalidConfig(
            "trusted worker must be a native ELF executable, not a script or data file".into(),
        ));
    }

    if !metadata.is_file()
        || mode & 0o111 == 0
        || mode & 0o222 != 0
        || mode & (libc::S_ISUID | libc::S_ISGID) != 0
        || metadata.uid() != 0
    {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted executable must be root-owned, executable, non-writable, and not setuid/setgid: {}",
            canonical.display()
        )));
    }

    // A protected file inside a writable or user-owned parent is still
    // replaceable before exec. Every parent must be root-owned and not
    // group/world writable. This intentionally excludes binaries installed
    // inside home directories or temporary build trees.
    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory)?;
        if !metadata.is_dir() || metadata.mode() & 0o022 != 0 || metadata.uid() != 0 {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted executable has an unsafe parent directory: {}",
                directory.display()
            )));
        }
        if directory == Path::new("/") {
            break;
        }
        parent = directory.parent();
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_scope_is_component_aware() {
        assert!(path_is_within_grant(
            "workspace/src/main.rs",
            "workspace/src"
        ));
        assert!(path_is_within_grant("workspace/src", "workspace/src"));
        assert!(!path_is_within_grant(
            "workspace/src2/main.rs",
            "workspace/src"
        ));
        assert!(!path_is_within_grant("../etc/passwd", ""));
    }

    #[test]
    fn path_validation_rejects_traversal_absolute_and_overlong_paths() {
        assert!(validate_relative_path("../etc/passwd", false).is_err());
        assert!(validate_relative_path("/etc/passwd", false).is_err());
        assert!(validate_relative_path("a//b", false).is_err());
        assert!(validate_relative_path("a/./b", false).is_err());
        assert!(validate_relative_path("workspace/a.rs", false).is_ok());
        assert!(validate_relative_path("", true).is_ok());
        assert!(validate_relative_path(&"a".repeat(MAX_SANDBOX_PATH_BYTES + 1), false).is_err());
        assert!(validate_relative_path(
            &format!("dir/{}", "x".repeat(MAX_SANDBOX_PATH_COMPONENT_BYTES + 1)),
            false
        )
        .is_err());
    }

    #[test]
    fn trusted_executable_rejects_temporary_user_controlled_paths() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("klyn-worker");
        fs::write(&executable, b"not-an-executable-worker").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            validate_trusted_executable(&executable).is_err(),
            "temporary or user-controlled worker binary was accepted"
        );
        assert!(
            validate_trusted_executable("/bin/sh").is_err(),
            "generic shell must not be accepted as the trusted worker"
        );
    }

    #[test]
    fn trusted_root_rejects_host_root_and_virtual_kernel_trees() {
        assert!(validate_trusted_root("/").is_err());
        assert!(validate_trusted_root("/proc").is_err());
        assert!(validate_trusted_root("/sys").is_err());
        assert!(validate_trusted_root("/dev").is_err());
        assert!(validate_trusted_root("/run").is_err());

        let workspace = tempfile::tempdir().unwrap();
        assert_eq!(
            validate_trusted_root(workspace.path()).unwrap(),
            fs::canonicalize(workspace.path()).unwrap()
        );
    }

    #[test]
    fn pinned_path_open_rejects_symlink_components() {
        use std::os::unix::fs::symlink;

        let workspace = tempfile::tempdir().unwrap();
        fs::create_dir(workspace.path().join("real")).unwrap();
        fs::write(workspace.path().join("real/data.txt"), b"safe").unwrap();
        symlink("real", workspace.path().join("alias")).unwrap();

        let real = open_path_no_symlinks(workspace.path().join("real"), true).unwrap();
        assert!(real.metadata().unwrap().is_dir());
        assert!(
            open_path_no_symlinks(workspace.path().join("alias"), true).is_err(),
            "pinned root open followed a symbolic link"
        );
        assert!(
            open_path_no_symlinks(workspace.path().join("alias/data.txt"), false).is_err(),
            "pinned file open followed a symbolic link component"
        );
    }

    #[test]
    fn capability_rejects_ambiguous_duplicate_grants() {
        let mut claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id: "duplicate-scope".into(),
            subject_uid: 1000,
            subject_gid: 1000,
            expires_at_unix: u64::MAX,
            file_grants: vec![
                FileGrant {
                    root_id: "workspace".into(),
                    prefix: "src".into(),
                    access: FileAccess::Read,
                },
                FileGrant {
                    root_id: "workspace".into(),
                    prefix: "src".into(),
                    access: FileAccess::Write,
                },
            ],
            network_grants: vec![],
            budget: ResourceBudget {
                memory_max_bytes: 1024 * 1024,
                cpu_quota_micros: 100_000,
                cpu_period_micros: 100_000,
                pids_max: 4,
                io_limits: vec![],
            },
        };
        assert!(claims.validate().is_err());

        claims.file_grants.clear();
        claims.network_grants = vec![
            NetworkGrant {
                address: "127.0.0.1:8080".into(),
            },
            NetworkGrant {
                address: "127.0.0.1:8080".into(),
            },
        ];
        assert!(claims.validate().is_err());
    }

    #[test]
    fn current_cgroup_resolution_rejects_missing_root_and_traversal() {
        let mount = tempfile::tempdir().unwrap();
        fs::create_dir(mount.path().join("workers")).unwrap();
        fs::create_dir(mount.path().join("workers/agent")).unwrap();

        let resolved =
            resolve_current_cgroup_path("12:cpu:/workers/agent\n0::/workers/agent\n", mount.path())
                .unwrap();
        assert_eq!(
            resolved,
            fs::canonicalize(mount.path().join("workers/agent")).unwrap()
        );

        assert!(resolve_current_cgroup_path("0::/\n", mount.path()).is_err());
        assert!(resolve_current_cgroup_path("12:cpu:/workers/agent\n", mount.path()).is_err());
        assert!(resolve_current_cgroup_path("0::/../outside\n", mount.path()).is_err());
    }

    #[test]
    fn cgroup_limit_readback_must_match_the_signed_budget() {
        let dir = tempfile::tempdir().unwrap();
        let budget = ResourceBudget {
            memory_max_bytes: 4096,
            cpu_quota_micros: 50_000,
            cpu_period_micros: 100_000,
            pids_max: 8,
            io_limits: vec![IoDeviceLimit {
                major: 8,
                minor: 0,
                rbps: Some(1024),
                wbps: None,
                riops: None,
                wiops: None,
            }],
        };
        fs::write(dir.path().join("memory.max"), "4096").unwrap();
        fs::write(dir.path().join("memory.swap.max"), "0").unwrap();
        fs::write(dir.path().join("memory.oom.group"), "1").unwrap();
        fs::write(dir.path().join("cpu.max"), "50000 100000").unwrap();
        fs::write(dir.path().join("pids.max"), "8").unwrap();
        fs::write(
            dir.path().join("io.max"),
            "8:0 rbps=1024 wbps=max riops=max wiops=max\n",
        )
        .unwrap();
        assert!(verify_budget_controls(dir.path(), &budget).is_ok());

        // A kernel-rounded-down memory value is stricter and therefore safe.
        fs::write(dir.path().join("memory.max"), "2048").unwrap();
        assert!(verify_budget_controls(dir.path(), &budget).is_ok());

        fs::write(dir.path().join("memory.max"), "max").unwrap();
        assert!(verify_budget_controls(dir.path(), &budget).is_err());
    }

    #[test]
    fn budgets_reject_zero_and_duplicate_devices() {
        let mut budget = ResourceBudget {
            memory_max_bytes: 1024,
            cpu_quota_micros: 100_000,
            cpu_period_micros: 100_000,
            pids_max: 1,
            io_limits: vec![],
        };
        assert!(budget.validate().is_ok());
        budget.memory_max_bytes = 0;
        assert!(budget.validate().is_err());
        budget.memory_max_bytes = 1024;
        budget.io_limits = vec![
            IoDeviceLimit {
                major: 8,
                minor: 0,
                rbps: Some(1024),
                wbps: None,
                riops: None,
                wiops: None,
            },
            IoDeviceLimit {
                major: 8,
                minor: 0,
                rbps: None,
                wbps: Some(1024),
                riops: None,
                wiops: None,
            },
        ];
        assert!(budget.validate().is_err());
    }

    #[test]
    fn access_modes_do_not_escalate() {
        assert!(FileAccess::ReadWrite.permits(FileAccess::Read));
        assert!(FileAccess::ReadWrite.permits(FileAccess::Write));
        assert!(!FileAccess::Read.permits(FileAccess::Write));
        assert!(!FileAccess::Write.permits(FileAccess::Read));
    }
}
