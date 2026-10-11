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
pub mod landlock_seccomp;

use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const OCAP_VERSION: u32 = 1;
pub const MAX_BROKER_FRAME_BYTES: usize = 64 * 1024;
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
        if self.cpu_quota_micros == 0
            || !(1_000..=1_000_000).contains(&self.cpu_period_micros)
        {
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
        let mut devices = BTreeSet::new();
        for limit in &self.io_limits {
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

        for grant in &self.file_grants {
            if grant.root_id.is_empty() || grant.root_id.len() > 128 {
                return Err(SandboxError::InvalidConfig(
                    "file grant root_id must contain 1..=128 bytes".into(),
                ));
            }
            validate_relative_path(&grant.prefix, true)?;
        }
        for grant in &self.network_grants {
            grant.address.parse::<std::net::SocketAddr>().map_err(|_| {
                SandboxError::InvalidConfig(format!(
                    "network grant must be a literal socket address: {}",
                    grant.address
                ))
            })?;
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
    }
    Ok(())
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
        for controller in ["cpu", "memory", "pids"] {
            if !available.split_whitespace().any(|c| c == controller) {
                return Err(SandboxError::InvalidConfig(format!(
                    "required cgroup-v2 controller is unavailable: {controller}"
                )));
            }
        }
        if !budget.io_limits.is_empty()
            && !available.split_whitespace().any(|c| c == "io")
        {
            return Err(SandboxError::InvalidConfig(
                "I/O budget requested but cgroup-v2 io controller is unavailable".into(),
            ));
        }

        let path = root.join(id);
        fs::create_dir(&path)?;
        let result = (|| -> Result<(), SandboxError> {
            write_control(&path.join("memory.max"), &budget.memory_max_bytes.to_string())?;
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
        write_control(&self.path.join("cgroup.procs"), &pid.to_string())
    }

    pub fn kill_all(&self) -> Result<(), SandboxError> {
        let path = self.path.join("cgroup.kill");
        if !path.exists() {
            return Err(SandboxError::Enforcement(
                "cgroup.kill is unavailable; refusing an incomplete group kill".into(),
            ));
        }
        write_control(&path, "1")
    }
}

impl Drop for CgroupV2 {
    fn drop(&mut self) {
        // A non-empty cgroup cannot be removed; cleanup is best effort here.
        let _ = fs::remove_dir(&self.path);
    }
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

/// Verify that a configured executable is not writable by group or other users.
/// The directory containing it must also be controlled by the daemon operator.
pub fn validate_trusted_executable(path: impl AsRef<Path>) -> Result<PathBuf, SandboxError> {
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    let mode = metadata.mode();
    let owner = metadata.uid();
    let euid = unsafe { libc::geteuid() };
    if !metadata.is_file()
        || mode & 0o111 == 0
        || mode & 0o022 != 0
        || (owner != 0 && owner != euid)
    {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted executable has unsafe type, mode, or owner: {}",
            canonical.display()
        )));
    }
    // Check every ancestor to prevent replacement between validation and exec.
    let mut ancestor = canonical.parent();
    while let Some(directory) = ancestor {
        let meta = fs::metadata(directory)?;
        if !meta.is_dir()
            || meta.mode() & 0o022 != 0
            || (meta.uid() != 0 && meta.uid() != euid)
        {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted executable has an unsafe ancestor directory: {}",
                directory.display()
            )));
        }
        ancestor = directory.parent();
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_scope_is_component_aware() {
        assert!(path_is_within_grant("workspace/src/main.rs", "workspace/src"));
        assert!(path_is_within_grant("workspace/src", "workspace/src"));
        assert!(!path_is_within_grant("workspace/src2/main.rs", "workspace/src"));
        assert!(!path_is_within_grant("../etc/passwd", ""));
    }

    #[test]
    fn path_validation_rejects_traversal_and_absolute_paths() {
        assert!(validate_relative_path("../etc/passwd", false).is_err());
        assert!(validate_relative_path("/etc/passwd", false).is_err());
        assert!(validate_relative_path("a//b", false).is_err());
        assert!(validate_relative_path("a/./b", false).is_err());
        assert!(validate_relative_path("workspace/a.rs", false).is_ok());
        assert!(validate_relative_path("", true).is_ok());
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


use std::{
    ffi::CString,
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
    os::unix::fs::FileTypeExt,
    os::unix::process::CommandExt,
    process::{Child, Command, ExitStatus},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

/// Immutable manifest transferred to a worker over a sealed memfd. Root paths
/// are canonical daemon-configured directories, not caller-selected paths.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SandboxManifest {
    pub capability: SignedCapability,
    pub roots: std::collections::BTreeMap<String, PathBuf>,
    pub broker_socket: PathBuf,
    pub broker_uid: u32,
}

#[derive(Clone, Debug)]
pub struct SandboxLaunchConfig {
    pub init_binary: PathBuf,
    pub worker_binary: PathBuf,
    pub delegated_cgroup_root: PathBuf,
    pub broker_socket: PathBuf,
    pub roots: std::collections::BTreeMap<String, PathBuf>,
}

pub struct SandboxLauncher {
    config: SandboxLaunchConfig,
    verifier: Arc<dyn broker::CapabilityVerifier>,
    revocations: Arc<dyn broker::RevocationOracle>,
}

impl SandboxLauncher {
    pub fn new(
        mut config: SandboxLaunchConfig,
        verifier: Arc<dyn broker::CapabilityVerifier>,
        revocations: Arc<dyn broker::RevocationOracle>,
    ) -> Result<Self, SandboxError> {
        config.init_binary = validate_trusted_executable(&config.init_binary)?;
        config.worker_binary = validate_trusted_executable(&config.worker_binary)?;
        config.delegated_cgroup_root = fs::canonicalize(config.delegated_cgroup_root)?;
        let mut roots = std::collections::BTreeMap::new();
        for (id, path) in config.roots {
            if id.is_empty() || id.len() > 128 || roots.contains_key(&id) {
                return Err(SandboxError::InvalidConfig("invalid or duplicate trusted root id".into()));
            }
            let canonical = fs::canonicalize(path)?;
            if !fs::metadata(&canonical)?.is_dir() {
                return Err(SandboxError::InvalidConfig(format!(
                    "trusted root is not a directory: {}",
                    canonical.display()
                )));
            }
            roots.insert(id, canonical);
        }
        config.roots = roots;
        if config.broker_socket.as_os_str().is_empty() {
            return Err(SandboxError::InvalidConfig("broker socket path is empty".into()));
        }
        Ok(Self { config, verifier, revocations })
    }

    /// Launch an already-signed OCap v1 task. The child is held at a start gate
    /// until the daemon has attached it to the resource cgroup. Namespace setup
    /// and UID/GID dropping happen in the trusted init helper before worker exec.
    pub fn spawn(
        &self,
        capability: SignedCapability,
        cgroup_id: &str,
        worker_args: &[std::ffi::OsString],
    ) -> Result<SandboxedChild, SandboxError> {
        self.verifier.verify(&capability)
            .map_err(|_| SandboxError::InvalidConfig("capability signature verification failed".into()))?;
        let claims = &capability.claims;
        claims.validate()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| SandboxError::Enforcement("system clock is before UNIX epoch".into()))?
            .as_secs();
        if now >= claims.expires_at_unix {
            return Err(SandboxError::InvalidConfig("capability expired before launch".into()));
        }
        if self.revocations.is_revoked(&claims.token_id)
            .map_err(|_| SandboxError::Enforcement("KEL revocation oracle failed closed".into()))?
        {
            return Err(SandboxError::InvalidConfig("capability revoked by KEL".into()));
        }
        for grant in &claims.file_grants {
            if !self.config.roots.contains_key(&grant.root_id) {
                return Err(SandboxError::InvalidConfig(format!(
                    "capability references unknown root {}",
                    grant.root_id
                )));
            }
        }

        // The worker connects after dropping to its signed subject UID/GID. The
        // broker socket's parent directory is protected from untrusted writes,
        // while per-request SO_PEERCRED and capability verification authorize it.
        let socket_meta = fs::symlink_metadata(&self.config.broker_socket)?;
        let daemon_uid = unsafe { libc::geteuid() };
        if !socket_meta.file_type().is_socket()
            || socket_meta.mode() & 0o777 != 0o666
            || (socket_meta.uid() != 0 && socket_meta.uid() != daemon_uid)
        {
            return Err(SandboxError::InvalidConfig(
                "broker endpoint must be a trusted Unix socket with exact mode 0666".into(),
            ));
        }

        // Build and seal the manifest before starting any worker process.
        let manifest = SandboxManifest {
            capability: capability.clone(),
            roots: self.config.roots.clone(),
            broker_socket: self.config.broker_socket.clone(),
            broker_uid: socket_meta.uid(),
        };
        let mut manifest_file = create_sealed_manifest(&manifest)?;
        manifest_file.seek(SeekFrom::Start(0))?;

        // O_CLOEXEC on all source descriptors prevents ambient inheritance.
        // The trusted pre_exec trampoline duplicates only FD 3 (broker), FD 4
        // (sealed manifest), and FD 5 (start gate) to their fixed child numbers.
        let mut pipe = [-1; 2];
        if unsafe { libc::pipe2(pipe.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
            return Err(SandboxError::Io(std::io::Error::last_os_error()));
        }
        let gate_read = unsafe { OwnedFd::from_raw_fd(pipe[0]) };
        let gate_write = unsafe { OwnedFd::from_raw_fd(pipe[1]) };
        let gate_for_child = duplicate_cloexec(gate_read.as_raw_fd(), 10)?;
        let manifest_for_child = duplicate_cloexec(manifest_file.as_raw_fd(), 11)?;

        let mut cgroup = CgroupV2::create(
            &self.config.delegated_cgroup_root,
            cgroup_id,
            &claims.budget,
        )?;

        let mut command = Command::new(&self.config.init_binary);
        command
            .arg("--uid").arg(claims.subject_uid.to_string())
            .arg("--gid").arg(claims.subject_gid.to_string())
            .arg("--")
            .arg(&self.config.worker_binary)
            .args(worker_args)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C");

        // No allocation, locks, logging, or non-async-signal-safe work occurs
        // in pre_exec: it only duplicates already-open descriptors.
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(gate_for_child.as_raw_fd(), 5) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::dup2(manifest_for_child.as_raw_fd(), MANIFEST_FD) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }

        let mut child = command.spawn()?;
        drop(command);
        drop(gate_read);

        if let Err(error) = cgroup.attach_pid(child.id()) {
            let _ = cgroup.kill_all();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let release = [0xA5u8];
        let written = unsafe {
            libc::write(gate_write.as_raw_fd(), release.as_ptr().cast(), release.len())
        };
        drop(gate_write);
        if written != 1 {
            let error = std::io::Error::last_os_error();
            let _ = cgroup.kill_all();
            let _ = child.kill();
            let _ = child.wait();
            return Err(SandboxError::Io(error));
        }

        Ok(SandboxedChild { child, cgroup, exited: false })
    }
}

/// Waitable child retaining its cgroup, so drop/kill tears down the entire task.
pub struct SandboxedChild {
    child: Child,
    cgroup: CgroupV2,
    exited: bool,
}

impl SandboxedChild {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn cgroup_path(&self) -> &Path {
        self.cgroup.path()
    }

    pub fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.exited = true;
        }
        Ok(status)
    }

    pub fn wait(&mut self) -> std::io::Result<ExitStatus> {
        let status = self.child.wait()?;
        self.exited = true;
        Ok(status)
    }

    pub fn kill(&mut self) -> Result<(), SandboxError> {
        self.cgroup.kill_all()?;
        let _ = self.child.kill();
        self.child.wait()?;
        self.exited = true;
        Ok(())
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        if !self.exited {
            let _ = self.cgroup.kill_all();
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.exited = true;
        }
    }
}

fn duplicate_cloexec(fd: RawFd, min_fd: RawFd) -> Result<OwnedFd, SandboxError> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, min_fd) };
    if duplicate < 0 {
        return Err(SandboxError::Io(std::io::Error::last_os_error()));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(duplicate) })
}

fn create_sealed_manifest(manifest: &SandboxManifest) -> Result<File, SandboxError> {
    const REQUIRED_SEALS: libc::c_int =
        libc::F_SEAL_WRITE | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_SEAL;
    let name = CString::new("klyn-sandbox-manifest")
        .map_err(|e| SandboxError::InvalidConfig(e.to_string()))?;
    let raw = unsafe {
        libc::syscall(
            libc::SYS_memfd_create,
            name.as_ptr(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        ) as RawFd
    };
    if raw < 0 {
        return Err(SandboxError::Enforcement(format!(
            "memfd_create unavailable: {}",
            std::io::Error::last_os_error()
        )));
    }
    let mut file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
    let encoded = serde_json::to_vec(manifest)?;
    if encoded.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::InvalidConfig("sealed manifest exceeds size limit".into()));
    }
    file.write_all(&encoded)?;
    file.flush()?;
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, REQUIRED_SEALS) } < 0 {
        return Err(SandboxError::Enforcement(format!(
            "sealing manifest failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(file)
}

/// Read FD 4 only if the kernel reports all required memfd seals.
pub fn read_sealed_manifest(fd: RawFd) -> Result<SandboxManifest, SandboxError> {
    const REQUIRED_SEALS: libc::c_int =
        libc::F_SEAL_WRITE | libc::F_SEAL_SHRINK | libc::F_SEAL_GROW | libc::F_SEAL_SEAL;
    let seals = unsafe { libc::fcntl(fd, libc::F_GET_SEALS) };
    if seals < 0 || seals & REQUIRED_SEALS != REQUIRED_SEALS {
        return Err(SandboxError::Enforcement(
            "worker manifest is not a fully sealed memfd".into(),
        ));
    }
    let duplicate = duplicate_cloexec(fd, 10)?;
    let mut file = File::from(duplicate);
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take((MAX_BROKER_FRAME_BYTES + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::InvalidConfig("manifest size out of bounds".into()));
    }
    let manifest: SandboxManifest = serde_json::from_slice(&bytes)?;
    manifest.capability.claims.validate()?;
    Ok(manifest)
}

/// Trusted worker bootstrap. It reads the sealed manifest, opens the broker on
/// FD 3, closes the manifest descriptor, then applies required kernel policy.
/// On any error the caller must terminate the process immediately.
pub fn bootstrap_worker() -> Result<broker::BrokerClient, SandboxError> {
    let manifest = read_sealed_manifest(MANIFEST_FD)?;
    let client = broker::BrokerClient::connect_verified_reserved(
        &manifest.broker_socket,
        manifest.broker_uid,
    ).map_err(|e| SandboxError::Enforcement(format!("broker connection or peer verification failed: {e}")))?;
    if unsafe { libc::close(MANIFEST_FD) } != 0 {
        return Err(SandboxError::Enforcement(format!(
            "closing manifest FD failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    landlock_seccomp::enforce_worker(
        &manifest.capability.claims,
        &manifest.roots,
        BROKER_FD,
    )?;
    Ok(client)
}


