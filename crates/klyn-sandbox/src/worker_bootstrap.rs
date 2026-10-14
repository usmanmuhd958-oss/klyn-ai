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
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::{SigningKey, VerifyingKey};

pub use crate::manifest::{WorkerManifest, WORKER_MANIFEST_VERSION};

use crate::{
    broker::{BrokerClient, CapabilityVerifier, Ed25519CapabilityVerifier},
    ipc_ring::{
        RingConsumer, RingProducer, COMMAND_RING_HEAD_FD, COMMAND_RING_PAYLOAD_FD,
        COMMAND_RING_TAIL_FD, RESPONSE_RING_HEAD_FD, RESPONSE_RING_PAYLOAD_FD,
        RESPONSE_RING_TAIL_FD,
    },
    kel::{self, KelAttestationChallenge, KEL_CHALLENGE_FRAME_LEN, KEL_RESPONSE_FRAME_LEN},
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

    // Compute attestation commitments and obtain the ephemeral worker identity
    // before seccomp is installed. The private key never leaves this process.
    let kel_session_id = kel::session_id_from_token_id(&manifest.capability.claims.token_id);
    let manifest_hash = kel::hash_serializable(&manifest)?;
    let capability_hash = kel::hash_serializable(&manifest.capability)?;
    let executable_hash = kel::parse_sha256_hex(&manifest.worker_executable_sha256)?;
    let attestation_key = generate_attestation_key()?;

    // The sealed manifest and OCap signature are verified before the worker
    // maps shared IPC. FD positions are fixed by the trusted supervisor; the
    // ring constructors validate each memfd's exact size and resize seals.
    // SAFETY: stage-0 inherits these six distinct descriptors at the fixed
    // constants below, and ownership transfers to the ring endpoint constructors.
    let mut command_ring = unsafe {
        RingConsumer::from_inherited_fds(
            COMMAND_RING_PAYLOAD_FD,
            COMMAND_RING_HEAD_FD,
            COMMAND_RING_TAIL_FD,
        )?
    };
    // SAFETY: these are the three remaining, distinct response-ring descriptors
    // created by the same trusted supervisor launch path.
    let mut response_ring = unsafe {
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
    // Capture the cgroup identity before seccomp denies path-based metadata calls.
    let cgroup_id = fs::metadata(&manifest.cgroup_path)?.ino();

    // Connect before seccomp: after enforcement, socket creation/connect is
    // intentionally unavailable to the worker. Broker requests re-check
    // signature, expiry, peer credentials, and revocation on every operation.
    let broker = BrokerClient::connect_reserved(&manifest.broker_socket)
        .map_err(|e| SandboxError::Enforcement(format!("broker connection failed: {e}")))?;

    landlock_seccomp::enforce_worker(&manifest.capability.claims, &manifest.roots, BROKER_FD)?;

    // Complete the KEL challenge-response after the kernel policy is installed
    // but BEFORE reporting policy readiness or accepting mission release.
    let identity = kel::KelAttestationIdentity {
        session_id: kel_session_id,
        cgroup_id,
        manifest_hash,
        capability_hash,
        executable_hash,
        daemon_public_key: verification_key.to_bytes(),
    };
    let mut challenge_frame = [0u8; KEL_CHALLENGE_FRAME_LEN];
    {
        let frame = command_ring
            .wait_peek(Some(Duration::from_secs(15)))?
            .ok_or_else(|| {
                SandboxError::Enforcement("supervisor did not provide the KEL challenge".into())
            })?;
        if frame.payload().len() != KEL_CHALLENGE_FRAME_LEN {
            return Err(SandboxError::Enforcement(
                "supervisor KEL challenge frame has an invalid length".into(),
            ));
        }
        challenge_frame.copy_from_slice(frame.payload());
        frame.consume()?;
    }
    let mut response_frame = [0u8; KEL_RESPONSE_FRAME_LEN];
    respond_to_attestation_challenge(
        &challenge_frame,
        &attestation_key,
        identity,
        &mut response_frame,
    )?;
    response_ring.push_wait(&response_frame, Duration::from_secs(15))?;

    // The supervisor now verifies the worker's KEL proof and persists both
    // WorkerAttested and PolicyGateClear before sending the mission-release ACK.
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

/// Validate the launch commitments before answering the first shared-ring frame.
/// No command other than this one-shot challenge is permitted before attestation.
pub fn respond_to_attestation_challenge(
    frame: &[u8],
    worker_key: &SigningKey,
    identity: kel::KelAttestationIdentity,
    response: &mut [u8; KEL_RESPONSE_FRAME_LEN],
) -> Result<(), SandboxError> {
    let challenge = KelAttestationChallenge::decode_frame(frame)?;
    if challenge.session_id != identity.session_id
        || challenge.manifest_hash != identity.manifest_hash
        || challenge.capability_hash != identity.capability_hash
        || challenge.executable_hash != identity.executable_hash
        || challenge.daemon_public_key != identity.daemon_public_key
        || challenge.launcher_pid == 0
        || challenge.cgroup_id != identity.cgroup_id
    {
        return Err(SandboxError::Enforcement(
            "KEL challenge does not match the verified worker manifest and capability".into(),
        ));
    }
    challenge.build_worker_response(worker_key, response);
    Ok(())
}

fn generate_attestation_key() -> Result<SigningKey, SandboxError> {
    let mut secret = [0u8; 32];
    let mut filled = 0usize;
    while filled < secret.len() {
        let result = unsafe {
            libc::getrandom(
                secret[filled..].as_mut_ptr().cast(),
                secret.len() - filled,
                0,
            )
        };
        if result > 0 {
            filled += result as usize;
            continue;
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::Interrupted {
            continue;
        }
        return Err(SandboxError::Io(error));
    }
    Ok(SigningKey::from_bytes(&secret))
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
                    operation: crate::WorkerOperation::Control,
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
    fn attestation_response_requires_exact_verified_lineage() {
        let daemon = SigningKey::from_bytes(&[7; 32]);
        let worker = SigningKey::from_bytes(&[9; 32]);
        let identity = kel::KelAttestationIdentity {
            session_id: kel::session_id_from_token_id("worker-test"),
            cgroup_id: 5678,
            manifest_hash: [1; 32],
            capability_hash: [2; 32],
            executable_hash: [3; 32],
            daemon_public_key: daemon.verifying_key().to_bytes(),
        };
        let challenge = KelAttestationChallenge {
            session_id: identity.session_id,
            nonce: [0xA5; 32],
            launcher_pid: 1234,
            cgroup_id: 5678,
            manifest_hash: identity.manifest_hash,
            capability_hash: identity.capability_hash,
            executable_hash: identity.executable_hash,
            daemon_public_key: identity.daemon_public_key,
        };
        let mut frame = [0u8; kel::KEL_CHALLENGE_FRAME_LEN];
        challenge.encode_frame(&mut frame);
        let mut response = [0u8; KEL_RESPONSE_FRAME_LEN];
        respond_to_attestation_challenge(&frame, &worker, identity, &mut response)
            .expect("matching verified identity should respond");
        challenge
            .verify_worker_response(&response)
            .expect("supervisor must verify the worker signature");

        let mut wrong_identity = identity;
        wrong_identity.capability_hash[0] ^= 0x80;
        assert!(respond_to_attestation_challenge(
            &frame,
            &worker,
            wrong_identity,
            &mut response
        )
        .is_err());

        let mut wrong_cgroup = identity;
        wrong_cgroup.cgroup_id += 1;
        assert!(respond_to_attestation_challenge(
            &frame,
            &worker,
            wrong_cgroup,
            &mut response
        )
        .is_err());
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
            operation: crate::WorkerOperation::Control,
        };
        assert!(validate_capability_context(&claims).is_err());
    }
}
