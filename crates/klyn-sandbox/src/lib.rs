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
pub mod namespace;
pub mod supervisor;

use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use nix::sys::statfs::{statfs, CGROUP2_SUPER_MAGIC};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const OCAP_VERSION: u32 = 1;
pub const MAX_BROKER_FRAME_BYTES: usize = 64 * 1024;
pub const BROKER_FD: i32 = 3;
pub const MANIFEST_FD: i32 = 4;
/// Reserved root ID for the candidate workspace. Workers may read through the
/// broker, but writes must go through klyn-fs preimage-checked transactions.
pub const CANDIDATE_ROOT_ID: &str = "candidate";

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
    /// Exact klyn-fs transaction the worker may mutate, if any.
    pub candidate_transaction_id: Option<String>,
    /// Separate authority for asking the daemon to apply a preimage-checked
    /// candidate mutation. This never authorizes a direct write FD.
    pub candidate_write_enabled: bool,
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

        if let Some(transaction_id) = &self.candidate_transaction_id {
            validate_cgroup_id(transaction_id).map_err(|_| {
                SandboxError::InvalidConfig("invalid candidate transaction binding".into())
            })?;
        }
        if self.candidate_write_enabled && self.candidate_transaction_id.is_none() {
            return Err(SandboxError::InvalidConfig(
                "candidate write authority requires an exact transaction ID".into(),
            ));
        }

        for grant in &self.file_grants {
            if grant.root_id.is_empty() || grant.root_id.len() > 128 {
                return Err(SandboxError::InvalidConfig(
                    "file grant root_id must contain 1..=128 bytes".into(),
                ));
            }
            validate_relative_path(&grant.prefix, true)?;
            if grant.root_id == CANDIDATE_ROOT_ID {
                if grant.access != FileAccess::Read {
                    return Err(SandboxError::InvalidConfig(
                        "candidate workspace file grants must be read-only".into(),
                    ));
                }
                if self.candidate_transaction_id.as_deref() != Some(grant.prefix.as_str()) {
                    return Err(SandboxError::InvalidConfig(
                        "candidate file grant must be bound to the exact candidate transaction"
                            .into(),
                    ));
                }
            }
        }
        if self.candidate_write_enabled
            && !self.file_grants.iter().any(|grant| {
                grant.root_id == CANDIDATE_ROOT_ID
                    && self.candidate_transaction_id.as_deref() == Some(grant.prefix.as_str())
                    && grant.access == FileAccess::Read
            })
        {
            return Err(SandboxError::InvalidConfig(
                "candidate write authority requires a matching read-scoped candidate root".into(),
            ));
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
        if component.is_empty() || component == "." || component == ".." || component == ".git" {
            return Err(SandboxError::InvalidConfig(
                "path contains an empty, dot, parent, or Git metadata component".into(),
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
        let filesystem = statfs(&root)
            .map_err(|error| SandboxError::Enforcement(format!("cgroup statfs failed: {error}")))?;
        if filesystem.filesystem_type() != CGROUP2_SUPER_MAGIC {
            return Err(SandboxError::InvalidConfig(
                "resource limits require a real cgroup-v2 filesystem".into(),
            ));
        }
        if !root.join("cgroup.controllers").is_file()
            || !root.join("cgroup.subtree_control").is_file()
        {
            return Err(SandboxError::InvalidConfig(
                "delegated root is missing cgroup-v2 controller metadata".into(),
            ));
        }
        let available = fs::read_to_string(root.join("cgroup.controllers"))?;
        let enabled = fs::read_to_string(root.join("cgroup.subtree_control"))?;
        for controller in ["cpu", "memory", "pids"] {
            if !available.split_whitespace().any(|c| c == controller) {
                return Err(SandboxError::InvalidConfig(format!(
                    "required cgroup-v2 controller is unavailable: {controller}"
                )));
            }
            if !enabled.split_whitespace().any(|c| c == controller) {
                return Err(SandboxError::InvalidConfig(format!(
                    "required cgroup-v2 controller is not enabled for delegated children: {controller}"
                )));
            }
        }
        if !budget.io_limits.is_empty()
            && (!available.split_whitespace().any(|c| c == "io")
                || !enabled.split_whitespace().any(|c| c == "io"))
        {
            return Err(SandboxError::InvalidConfig(
                "I/O budget requested but cgroup-v2 io controller is unavailable or disabled"
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
    let euid = nix::unistd::geteuid().as_raw();

    if !metadata.is_file()
        || metadata.mode() & 0o111 == 0
        || metadata.mode() & 0o022 != 0
        || (metadata.uid() != 0 && metadata.uid() != euid)
    {
        return Err(SandboxError::InvalidConfig(format!(
            "trusted executable has unsafe type, mode, or owner: {}",
            canonical.display()
        )));
    }

    // The executable's containing directory must not permit replacement by
    // group/other users, nor be owned by an unrelated unprivileged identity.
    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory)?;
        if !metadata.is_dir()
            || metadata.mode() & 0o022 != 0
            || (metadata.uid() != 0 && metadata.uid() != euid)
        {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted executable parent is not operator-controlled: {}",
                directory.display()
            )));
        }
        parent = directory.parent();
    }

    Ok(canonical)
}

/// Daemon-owned capability signer. Keep the signing key in the daemon's
/// protected secret store; workers receive only the signed claims.
pub struct CapabilityIssuer {
    signing_key: SigningKey,
}

impl CapabilityIssuer {
    pub fn new(signing_key: SigningKey) -> Self {
        Self { signing_key }
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    pub fn issue(&self, claims: CapabilityClaims) -> Result<SignedCapability, SandboxError> {
        claims.validate()?;
        let canonical = serde_json::to_vec(&claims)?;
        let signature = self.signing_key.sign(&canonical).to_bytes().to_vec();
        Ok(SignedCapability { claims, signature })
    }
}

/// Trusted bootstrap entry point. The executable must call this before parsing
/// task instructions, loading plugins, starting threads, or executing model
/// output. The manifest is read only after the supervisor releases the gate.
/// Any unsupported primitive returns an error and the caller must exit nonzero.
pub fn bootstrap_worker_from_env(
    capability_manifest: impl AsRef<Path>,
    broker_socket: impl AsRef<Path>,
    verifier: &dyn broker::CapabilityVerifier,
    roots: &BTreeMap<String, PathBuf>,
) -> Result<(broker::BrokerClient, SignedCapability), SandboxError> {
    let gate_path = env::var_os("KLYN_START_GATE_PATH").ok_or_else(|| {
        SandboxError::InvalidConfig("required start-gate environment is missing".into())
    })?;

    namespace::await_start_gate(Path::new(&gate_path))?;
    namespace::enter_worker_namespaces()?;
    namespace::close_inherited_descriptors()?;

    let manifest_path = capability_manifest.as_ref();
    let before = fs::symlink_metadata(manifest_path)?;
    let uid = nix::unistd::Uid::current().as_raw();
    if before.file_type().is_symlink()
        || !before.is_file()
        || before.uid() != uid
        || before.mode() & 0o077 != 0
        || before.len() as usize > MAX_BROKER_FRAME_BYTES
    {
        return Err(SandboxError::InvalidConfig(
            "capability manifest must be a private, bounded regular file".into(),
        ));
    }

    let mut manifest = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(manifest_path)?;
    let after = manifest.metadata()?;
    if !after.is_file()
        || after.uid() != uid
        || after.ino() != before.ino()
        || after.dev() != before.dev()
    {
        return Err(SandboxError::Enforcement(
            "capability manifest identity changed while opening".into(),
        ));
    }

    let mut bytes = Vec::with_capacity(after.len() as usize);
    manifest
        .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::InvalidConfig(
            "capability manifest is empty or exceeds the size limit".into(),
        ));
    }
    drop(manifest);

    let token: SignedCapability = serde_json::from_slice(&bytes)?;
    verifier
        .verify(&token)
        .map_err(|_| SandboxError::Enforcement("worker capability signature is invalid".into()))?;

    // Establish the only permitted socket before Landlock and seccomp make
    // pathname socket creation and connect unavailable.
    let broker = broker::BrokerClient::connect_reserved(broker_socket).map_err(SandboxError::Io)?;
    landlock_seccomp::enforce_worker(&token.claims, roots, BROKER_FD)?;
    Ok((broker, token))
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
