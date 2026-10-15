//! Trusted worker bootstrap for the Linux sandbox.
//!
//! The daemon must provide FD 4 as a sealed memfd containing a WorkerManifest,
//! and provision the public verification key at the root-owned path below.
//! This module deliberately does not spawn processes: process creation and
//! cgroup attachment belong to the daemon supervisor, which must hold the
//! worker behind a start gate until cgroup membership is confirmed.

use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    time::{SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::VerifyingKey;

pub use crate::manifest::{WorkerManifest, WORKER_MANIFEST_VERSION};

use crate::{
    broker::{BrokerClient, CapabilityVerifier, Ed25519CapabilityVerifier},
    ipc_ring::{
        RingConsumer, RingProducer, COMMAND_RING_HEAD_FD, COMMAND_RING_PAYLOAD_FD,
        COMMAND_RING_TAIL_FD, RESPONSE_RING_HEAD_FD, RESPONSE_RING_PAYLOAD_FD,
        RESPONSE_RING_TAIL_FD,
    },
    landlock_seccomp, validate_trusted_root, CapabilityClaims, SandboxError, BROKER_FD,
    MANIFEST_FD, OCAP_VERSION,
};

/// The key must be provisioned by the trusted image/configuration manager.
/// It contains exactly 32 raw Ed25519 public-key bytes, never a private key.
pub const VERIFY_KEY_PATH: &str = "/etc/klyn/ocap-ed25519.pub";
pub struct WorkerBootstrapContext {
    pub manifest: WorkerManifest,
    pub broker: BrokerClient,
    pub command_ring: RingConsumer,
    pub response_ring: RingProducer,
}

/// Verify the sealed manifest and capability, connect to the broker, and apply
/// mandatory Landlock + seccomp restrictions. Any failure is fatal; callers
/// must exit without processing mission input.
pub fn initialize() -> Result<WorkerBootstrapContext, SandboxError> {
    let manifest = crate::manifest::read_sealed_manifest_fd(MANIFEST_FD)?;

    // A sealed memfd prevents mutation after sealing; the Ed25519 signature
    // establishes who authorized its contents. Both checks are mandatory.
    let verification_key = load_trusted_verifying_key()?;
    manifest.verify_signature(&verification_key)?;
    manifest.verify_worker_executable("/proc/self/exe")?;
    manifest.verify_current_fd_limit()?;
    // Filesystem root resolution happens only after the signer is trusted.
    validate_manifest_shape(&manifest)?;

    let verifier = Ed25519CapabilityVerifier::new(verification_key);
    verifier
        .verify(&manifest.capability)
        .map_err(|e| SandboxError::InvalidConfig(format!("capability verification failed: {e}")))?;

    validate_capability_context(&manifest.capability.claims)?;

    // The sealed manifest and OCap signature are verified before the worker
    // maps shared IPC. FD positions are fixed by the trusted supervisor; the
    // ring constructors validate each memfd's exact size and resize seals.
    // SAFETY: stage-0 inherits these six distinct descriptors at the fixed
    // constants below, and ownership transfers to the ring endpoint constructors.
    let command_ring = unsafe {
        RingConsumer::from_inherited_fds(
            COMMAND_RING_PAYLOAD_FD,
            COMMAND_RING_HEAD_FD,
            COMMAND_RING_TAIL_FD,
        )?
    };
    // SAFETY: these are the three remaining, distinct response-ring descriptors
    // created by the same trusted supervisor launch path.
    let response_ring = unsafe {
        RingProducer::from_inherited_fds(
            RESPONSE_RING_PAYLOAD_FD,
            RESPONSE_RING_HEAD_FD,
            RESPONSE_RING_TAIL_FD,
        )?
    };

    // Bind the running process to the exact signed cgroup leaf and read back
    // every enforced memory/CPU/PID/I/O control plus cpu.weight.
    crate::cgroup::CgroupV2Boundary::verify_current(
        &manifest.cgroup_path,
        &manifest.capability.claims.budget,
        manifest.cpu_weight,
    )?;

    // Connect before seccomp: after enforcement, socket creation/connect is
    // intentionally unavailable to the worker. Broker requests re-check
    // signature, expiry, peer credentials, and revocation on every operation.
    let broker = BrokerClient::connect_reserved(&manifest.broker_socket)
        .map_err(|e| SandboxError::Enforcement(format!("broker connection failed: {e}")))?;

    landlock_seccomp::enforce_worker(&manifest.capability.claims, &manifest.roots, BROKER_FD)?;

    // Do not return control to mission/runtime code until the supervisor has
    // observed this process after policy installation and sent the final ACK.
    // Failure or supervisor death is fatal; callers must not process input.
    crate::start_gate::worker_wait_for_supervisor_release()?;

    // Keep this reference explicit: the signed claims are the policy input,
    // not values independently supplied by the worker.
    let _: &CapabilityClaims = &manifest.capability.claims;

    Ok(WorkerBootstrapContext {
        manifest,
        broker,
        command_ring,
        response_ring,
    })
}

pub fn validate_manifest_shape(manifest: &WorkerManifest) -> Result<(), SandboxError> {
    manifest.validate_fields()?;
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
        let canonical = validate_trusted_root(path)?;
        if canonical != *path {
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

pub fn load_trusted_verifying_key() -> Result<VerifyingKey, SandboxError> {
    let path = std::path::Path::new(VERIFY_KEY_PATH);

    // The final file is opened with O_NOFOLLOW, then ownership/mode/size are
    // checked on that open file descriptor to avoid a check-then-open race.
    let mut parent = path.parent();
    while let Some(directory) = parent {
        let metadata = fs::symlink_metadata(directory)?;
        if !metadata.file_type().is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(SandboxError::InvalidConfig(format!(
                "verification-key directory is not root-controlled: {}",
                directory.display()
            )));
        }
        if directory == std::path::Path::new("/") {
            break;
        }
        parent = directory.parent();
    }

    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.len() != 32
    {
        return Err(SandboxError::InvalidConfig(
            "verification key must be a root-owned, non-group/world-writable regular file containing 32 raw bytes".into(),
        ));
    }

    let mut bytes = Vec::with_capacity(33);
    file.take(33).read_to_end(&mut bytes)?;
    let raw: [u8; 32] = bytes.try_into().map_err(|_| {
        SandboxError::InvalidConfig("Ed25519 public key must be exactly 32 bytes".into())
    })?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|e| SandboxError::InvalidConfig(format!("invalid Ed25519 public key: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SignedCapability;
    use std::{collections::BTreeMap, path::PathBuf};

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
            worker_executable_sha256: "a".repeat(64),
            allowed_execution_binary_sha256: vec!["a".repeat(64)],
            landlock_abi: crate::manifest::REQUIRED_LANDLOCK_ABI,
            max_open_fds: crate::manifest::WORKER_MAX_OPEN_FDS,
            cgroup_path: PathBuf::from("/sys/fs/cgroup/klyn/workers/test-worker"),
            cpu_weight: 100,
            signature: vec![],
        };
        assert!(validate_manifest_shape(&manifest).is_err());
    }

    #[test]
    fn rejects_expired_capability() {
        let claims = CapabilityClaims {
            version: OCAP_VERSION,
            token_id: "expired-test".into(),
            subject_uid: (unsafe { libc::geteuid() }).max(1),
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
