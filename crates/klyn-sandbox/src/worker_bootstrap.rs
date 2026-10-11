//! Trusted worker bootstrap for the Linux sandbox.
//!
//! The daemon must provide FD 4 as a sealed memfd containing a WorkerManifest,
//! and provision the public verification key at the root-owned path below.
//! This module deliberately does not spawn processes: process creation and
//! cgroup attachment belong to the daemon supervisor, which must hold the
//! worker behind a start gate until cgroup membership is confirmed.

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};

use crate::{
    broker::{BrokerClient, CapabilityVerifier, Ed25519CapabilityVerifier},
    landlock_seccomp, CapabilityClaims, SandboxError, SignedCapability,
    BROKER_FD, MANIFEST_FD, MAX_BROKER_FRAME_BYTES, OCAP_VERSION,
};

/// The key must be provisioned by the trusted image/configuration manager.
/// It contains exactly 32 raw Ed25519 public-key bytes, never a private key.
pub const VERIFY_KEY_PATH: &str = "/etc/klyn/ocap-ed25519.pub";
pub const WORKER_MANIFEST_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerManifest {
    pub version: u32,
    /// Trusted absolute path to the already-running broker's Unix socket.
    pub broker_socket: PathBuf,
    /// Daemon-configured root IDs mapped to trusted absolute directories.
    pub roots: BTreeMap<String, PathBuf>,
    pub capability: SignedCapability,
}

pub struct WorkerBootstrapContext {
    pub manifest: WorkerManifest,
    pub broker: BrokerClient,
}

/// Verify the sealed manifest and capability, connect to the broker, and apply
/// mandatory Landlock + seccomp restrictions. Any failure is fatal; callers
/// must exit without processing mission input.
pub fn initialize() -> Result<WorkerBootstrapContext, SandboxError> {
    let manifest = read_sealed_manifest()?;
    validate_manifest_shape(&manifest)?;

    let verifier = Ed25519CapabilityVerifier::new(load_trusted_verifying_key()?);
    verifier
        .verify(&manifest.capability)
        .map_err(|e| SandboxError::InvalidConfig(format!("capability verification failed: {e}")))?;

    validate_capability_context(&manifest.capability.claims)?;

    // Connect before seccomp: after enforcement, socket creation/connect is
    // intentionally unavailable to the worker. Broker requests re-check
    // signature, expiry, peer credentials, and revocation on every operation.
    let broker = BrokerClient::connect_reserved(&manifest.broker_socket)
        .map_err(|e| SandboxError::Enforcement(format!("broker connection failed: {e}")))?;

    landlock_seccomp::enforce_worker(
        &manifest.capability.claims,
        &manifest.roots,
        BROKER_FD,
    )?;

    // Keep this reference explicit: the signed claims are the policy input,
    // not values independently supplied by the worker.
    let _: &CapabilityClaims = &manifest.capability.claims;

    Ok(WorkerBootstrapContext { manifest, broker })
}

fn read_sealed_manifest() -> Result<WorkerManifest, SandboxError> {
    // FD 4 is a process contract shared with klyn-sandbox-init. Verify seals
    // before reading, and bound parsing to prevent memory-exhaustion payloads.
    let fd = MANIFEST_FD;
    let seals = unsafe { libc::fcntl(fd, libc::F_GET_SEALS) };
    if seals < 0 {
        return Err(SandboxError::Enforcement(
            "manifest descriptor is not a seal-capable memfd".into(),
        ));
    }

    let required = libc::F_SEAL_WRITE
        | libc::F_SEAL_GROW
        | libc::F_SEAL_SHRINK
        | libc::F_SEAL_SEAL;
    if seals & required != required {
        return Err(SandboxError::Enforcement(
            "manifest memfd is missing required immutability seals".into(),
        ));
    }

    // Confirm FD 4 is a regular file before taking ownership. This bootstrap
    // process is expected to be single-purpose and must not reuse FD 4 later.
    let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
        return Err(SandboxError::Io(std::io::Error::last_os_error()));
    }
    let stat = unsafe { stat.assume_init() };
    if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
        return Err(SandboxError::Enforcement(
            "manifest descriptor is not a regular file".into(),
        ));
    }

    // SAFETY: the launcher transfers ownership of FD 4 to this process.
    let mut file = unsafe { File::from_raw_fd(fd) };
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.take((MAX_BROKER_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::InvalidConfig(
            "worker manifest size is outside the permitted range".into(),
        ));
    }

    Ok(serde_json::from_slice(&bytes)?)
}

fn validate_manifest_shape(manifest: &WorkerManifest) -> Result<(), SandboxError> {
    if manifest.version != WORKER_MANIFEST_VERSION {
        return Err(SandboxError::InvalidConfig(format!(
            "unsupported worker manifest version {}",
            manifest.version
        )));
    }
    if !manifest.broker_socket.is_absolute() {
        return Err(SandboxError::InvalidConfig(
            "broker socket path must be absolute".into(),
        ));
    }
    if manifest.roots.is_empty() {
        return Err(SandboxError::InvalidConfig(
            "at least one trusted filesystem root must be configured".into(),
        ));
    }
    for (id, path) in &manifest.roots {
        if id.is_empty() || id.len() > 128 || !path.is_absolute() {
            return Err(SandboxError::InvalidConfig(
                "trusted root IDs must be bounded and paths must be absolute".into(),
            ));
        }
        let canonical = fs::canonicalize(path)?;
        if !fs::metadata(&canonical)?.is_dir() || canonical != *path {
            return Err(SandboxError::InvalidConfig(format!(
                "trusted root must be an existing canonical directory: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_capability_context(claims: &CapabilityClaims) -> Result<(), SandboxError> {
    claims.validate()?;
    if claims.version != OCAP_VERSION {
        return Err(SandboxError::InvalidConfig(
            "unsupported capability version".into(),
        ));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SandboxError::InvalidConfig("system clock is before Unix epoch".into()))?
        .as_secs();
    if claims.expires_at_unix <= now {
        return Err(SandboxError::InvalidConfig("capability has expired".into()));
    }
    // Root workers are rejected by claims.validate(). Also bind this token to
    // the effective identity established by the trusted launcher.
    if claims.subject_uid != unsafe { libc::geteuid() }
        || claims.subject_gid != unsafe { libc::getegid() }
    {
        return Err(SandboxError::InvalidConfig(
            "capability subject does not match worker effective UID/GID".into(),
        ));
    }
    Ok(())
}

fn load_trusted_verifying_key() -> Result<VerifyingKey, SandboxError> {
    let path = std::path::Path::new(VERIFY_KEY_PATH);
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.len() != 32
    {
        return Err(SandboxError::InvalidConfig(
            "verification key must be a root-owned, non-group/world-writable regular file containing 32 raw bytes".into(),
        ));
    }

    let bytes = fs::read(path)?;
    let raw: [u8; 32] = bytes.try_into().map_err(|_| {
        SandboxError::InvalidConfig("Ed25519 public key must be exactly 32 bytes".into())
    })?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|e| SandboxError::InvalidConfig(format!("invalid Ed25519 public key: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_broker_socket() {
        let manifest = WorkerManifest {
            version: WORKER_MANIFEST_VERSION,
            broker_socket: PathBuf::from("relative.sock"),
            roots: BTreeMap::new(),
            capability: SignedCapability {
                claims: CapabilityClaims {
                    version: OCAP_VERSION,
                    token_id: "test".into(),
                    subject_uid: 1000,
                    subject_gid: 1000,
                    expires_at_unix: u64::MAX,
                    file_grants: vec![],
                    network_grants: vec![],
                    budget: crate::ResourceBudget {
                        memory_max_bytes: 1024 * 1024,
                        cpu_quota_micros: 1000,
                        cpu_period_micros: 1000,
                        pids_max: 1,
                        io_limits: vec![],
                    },
                },
                signature: vec![],
            },
        };
        assert!(validate_manifest_shape(&manifest).is_err());
    }

    #[test]
    fn rejects_expired_capability() {
        let claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id: "expired-test".into(),
            subject_uid: unsafe { libc::geteuid() },
            subject_gid: unsafe { libc::getegid() },
            expires_at_unix: 0,
            file_grants: vec![],
            network_grants: vec![],
            budget: crate::ResourceBudget {
                memory_max_bytes: 1024 * 1024,
                cpu_quota_micros: 1000,
                cpu_period_micros: 1000,
                pids_max: 1,
                io_limits: vec![],
            },
        };
        assert!(validate_capability_context(&claims).is_err());
    }
}
