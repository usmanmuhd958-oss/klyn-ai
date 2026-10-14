//! Trusted supervisor lifecycle for launching one sealed KLYN worker.
//!
//! This is the only public path that composes manifest sealing, cgroup
//! configuration, blocked spawn, cgroup attachment/readback, and gate release.
//! Any error before RELEASE kills the launcher and leaves no runnable worker.

use std::{
    ffi::OsStr,
    fs::{self, File},
    io::{self, Read},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::{fs::MetadataExt, process::CommandExt},
    },
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::SigningKey;

use crate::{
    broker::{CapabilityVerifier, Ed25519CapabilityVerifier},
    cgroup::CgroupV2Boundary,
    fs_txn::{FsTransaction, SharedFsTransaction},
    ipc_ring::{
        RingConsumer, RingProducer, COMMAND_RING_HEAD_FD, COMMAND_RING_PAYLOAD_FD,
        COMMAND_RING_TAIL_FD, RESPONSE_RING_HEAD_FD, RESPONSE_RING_PAYLOAD_FD,
        RESPONSE_RING_TAIL_FD, WORKER_CMD_PING, WORKER_CMD_SHUTDOWN, WORKER_RESP_PING,
        WORKER_RESP_SHUTDOWN,
    },
    kel::{
        self, KelAttestationChallenge, KelEventKind, KelJournal, SharedKelJournal,
        KEL_CHALLENGE_FRAME_LEN, KEL_RESPONSE_FRAME_LEN,
    },
    manifest::{sha256_file, WorkerManifest, REQUIRED_LANDLOCK_ABI, WORKER_MAX_OPEN_FDS},
    start_gate::{StartGate, WorkerPolicyGate},
    telemetry::{TelemetryEvent, WorkerTelemetry},
    validate_trusted_executable, SandboxError, SignedCapability, MANIFEST_FD,
};

const WORKER_LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(3);
const WORKER_BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(15);

pub struct WorkerLaunchConfig {
    /// Root-controlled klyn-sandbox-init binary, not a generic command runner.
    pub init_executable: PathBuf,
    /// Root-controlled native ELF named klyn-worker.
    pub worker_executable: PathBuf,
    /// Pre-delegated cgroup-v2 hierarchy root.
    pub delegated_cgroup_root: PathBuf,
    /// Unique per-worker cgroup directory name.
    pub worker_id: String,
    pub broker_socket: PathBuf,
    pub roots: std::collections::BTreeMap<String, PathBuf>,
    pub capability: SignedCapability,
    pub cpu_weight: u32,
}

pub struct SpawnedWorker {
    child: Child,
    cgroup: CgroupV2Boundary,
    command_ring: RingProducer,
    response_ring: RingConsumer,
    kel_journal: Option<SharedKelJournal>,
    telemetry: Option<WorkerTelemetry>,
    filesystem_transaction: Option<SharedFsTransaction>,
}

impl Drop for SpawnedWorker {
    fn drop(&mut self) {
        // Stop the observer before intentional teardown so it cannot append an
        // exit anomaly after the terminal KEL event.
        let _ = self.stop_telemetry();
        // Dropping a std::process::Child does not terminate its process. Kill
        // the whole cgroup first and use the bounded cgroup-empty wait before
        // reaping stage-0. Never block an arbitrary destructor indefinitely.
        let _ = self.cgroup.kill_all();
        let _ = self.child.kill();
        if self
            .cgroup
            .terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT)
            .is_ok()
        {
            self.rollback_filesystem_after_cgroup_empty();
            let _ = self.record_cgroup_destroyed();
            let _ = self.child.wait();
        } else {
            if let Some(transaction) = &self.filesystem_transaction {
                match transaction.lock() {
                    Ok(transaction) => FsTransaction::abort_cleanup_failure(
                        Some(transaction.transaction_root()),
                        "could not confirm cgroup emptiness before filesystem rollback",
                    ),
                    Err(_) => FsTransaction::abort_cleanup_failure(
                        None,
                        "filesystem transaction lock poisoned during cgroup teardown",
                    ),
                }
            }
            let _ = self.child.try_wait();
        }
    }
}

impl SpawnedWorker {
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Encode the two deliberately supported worker control operations directly
    /// into a shared slot. The compatibility Value API never JSON-serializes
    /// the message on the IPC path.
    pub fn send_json(&mut self, value: &serde_json::Value) -> Result<(), SandboxError> {
        let object = value.as_object().ok_or_else(|| {
            SandboxError::InvalidConfig("worker command must be an object".into())
        })?;
        if object.len() != 1 {
            return Err(SandboxError::InvalidConfig(
                "worker command contains unknown fields".into(),
            ));
        }
        let operation = object
            .get("op")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| SandboxError::InvalidConfig("worker operation is missing".into()))?;
        let opcode = match operation {
            "ping" => WORKER_CMD_PING,
            "shutdown" => WORKER_CMD_SHUTDOWN,
            _ => {
                return Err(SandboxError::InvalidConfig(
                    "unsupported worker control operation".into(),
                ))
            }
        };
        self.send_frame(&[opcode])
    }

    /// Publish a fixed-size/bounded frame without allocating a temporary buffer.
    pub fn send_frame(&mut self, frame: &[u8]) -> Result<(), SandboxError> {
        match self.command_ring.push_wait(frame, WORKER_LIFECYCLE_TIMEOUT) {
            Ok(()) => Ok(()),
            Err(error) => {
                let cleanup = self.terminate();
                match cleanup {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                        "shared IPC command failed ({error}); cgroup termination also failed ({cleanup_error})"
                    ))),
                }
            }
        }
    }

    /// Wait for and decode one worker response. A malformed response or timeout
    /// is a worker-integrity failure and terminates the complete cgroup.
    pub fn read_json_response(&mut self) -> Result<Option<serde_json::Value>, SandboxError> {
        let parsed = {
            match self.response_ring.wait_peek(Some(WORKER_LIFECYCLE_TIMEOUT)) {
                Ok(Some(frame)) => {
                    let decoded = decode_worker_response(frame.payload());
                    match frame.consume() {
                        Ok(()) => decoded,
                        Err(error) => Err(error),
                    }
                }
                Ok(None) => Err(SandboxError::Enforcement(
                    "timed out waiting for worker IPC response".into(),
                )),
                Err(error) => Err(error),
            }
        };
        match parsed {
            Ok(response) => Ok(Some(response)),
            Err(error) => {
                let cleanup = self.terminate();
                match cleanup {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                        "shared IPC response failed ({error}); cgroup termination also failed ({cleanup_error})"
                    ))),
                }
            }
        }
    }

    pub fn cgroup_path(&self) -> &Path {
        self.cgroup.path()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, SandboxError> {
        Ok(self.child.try_wait()?)
    }

    pub fn wait(&mut self) -> Result<ExitStatus, SandboxError> {
        let deadline = std::time::Instant::now()
            .checked_add(WORKER_LIFECYCLE_TIMEOUT)
            .ok_or_else(|| {
                SandboxError::InvalidConfig("worker shutdown timeout is invalid".into())
            })?;
        loop {
            if let Some(status) = self.child.try_wait()? {
                self.stop_telemetry()?;
                self.cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT)?;
                self.rollback_filesystem_after_cgroup_empty();
                self.record_cgroup_destroyed()?;
                return Ok(status);
            }
            if std::time::Instant::now() >= deadline {
                let timeout_error = SandboxError::Enforcement(
                    "worker did not exit before the bounded shutdown deadline".into(),
                );
                return match self.terminate() {
                    Ok(()) => Err(timeout_error),
                    Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                        "{timeout_error}; cgroup termination failed: {cleanup_error}"
                    ))),
                };
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Explicit cancellation. The cgroup kill is authoritative and includes
    /// the PID-namespace init and every descendant, not just the direct child.
    pub fn terminate(&mut self) -> Result<(), SandboxError> {
        self.stop_telemetry()?;
        let _ = self.child.kill();
        if let Err(error) = self.cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT) {
            if let Some(transaction) = &self.filesystem_transaction {
                match transaction.lock() {
                    Ok(transaction) => FsTransaction::abort_cleanup_failure(
                        Some(transaction.transaction_root()),
                        "cgroup termination failed; transactional filesystem cannot be exposed",
                    ),
                    Err(_) => FsTransaction::abort_cleanup_failure(
                        None,
                        "filesystem transaction lock poisoned after cgroup termination failure",
                    ),
                }
            }
            return Err(error);
        }
        let _ = self.child.wait();
        self.rollback_filesystem_after_cgroup_empty();
        self.record_cgroup_destroyed()?;
        Ok(())
    }

    /// Receive one bounded telemetry event produced by the supervisor-owned monitor.
    pub fn try_telemetry_event(&self) -> Option<TelemetryEvent> {
        self.telemetry.as_ref().and_then(WorkerTelemetry::try_recv)
    }

    /// Stop telemetry before intentional shutdown or destruction.
    pub fn stop_telemetry(&mut self) -> Result<(), SandboxError> {
        if let Some(mut telemetry) = self.telemetry.take() {
            telemetry.stop_and_join()?;
        }
        Ok(())
    }

    fn rollback_filesystem_after_cgroup_empty(&self) {
        if let Some(transaction) = &self.filesystem_transaction {
            match transaction.lock() {
                Ok(mut transaction) => transaction.rollback_after_cgroup_empty_or_abort(),
                Err(_) => FsTransaction::abort_cleanup_failure(
                    None,
                    "filesystem transaction mutex was poisoned during rollback",
                ),
            }
        }
    }

    /// Clone the serialized KEL handle used by the independent telemetry monitor.
    pub fn kel_recorder(&self) -> Option<SharedKelJournal> {
        self.kel_journal.clone()
    }

    /// Return a verified sequence/root snapshot for an independent durable anchor.
    pub fn kel_head_snapshot(&self) -> Result<Option<kel::KelHeadSnapshot>, SandboxError> {
        match &self.kel_journal {
            Some(journal) => {
                let mut journal = journal.lock().map_err(|_| {
                    SandboxError::Enforcement("KEL journal lock is poisoned".into())
                })?;
                journal.verify_disk_state()?;
                Ok(Some(journal.head_snapshot()))
            }
            None => Ok(None),
        }
    }

    fn record_cgroup_destroyed(&self) -> Result<(), SandboxError> {
        let Some(journal) = &self.kel_journal else {
            return Ok(());
        };
        let path = self.cgroup.path().to_string_lossy();
        let payload_hash = kel::hash_payload(path.as_bytes());
        journal
            .lock()
            .map_err(|_| SandboxError::Enforcement("KEL journal lock is poisoned".into()))?
            .record_cgroup_destroyed(payload_hash)?;
        Ok(())
    }
}

pub fn decode_worker_response(bytes: &[u8]) -> Result<serde_json::Value, SandboxError> {
    match bytes {
        [WORKER_RESP_SHUTDOWN] => Ok(serde_json::json!({
            "ok": true,
            "state": "stopping"
        })),
        [WORKER_RESP_PING, pid0, pid1, pid2, pid3, namespace_init] => {
            let pid = u32::from_le_bytes([*pid0, *pid1, *pid2, *pid3]);
            if *namespace_init > 1 {
                return Err(SandboxError::Enforcement(
                    "worker IPC response has an invalid namespace flag".into(),
                ));
            }
            Ok(serde_json::json!({
                "ok": true,
                "namespace_init": *namespace_init == 1,
                "pid": pid
            }))
        }
        _ => Err(SandboxError::Enforcement(
            "worker IPC response has an unknown opcode or invalid length".into(),
        )),
    }
}

/// Fail closed on the legacy KEL-free launch API.
///
/// Every executable worker session must have a fresh signed journal and a
/// verified SPSC challenge-response. Call launch_worker_with_kel with a
/// daemon-controlled journal path instead of using this compatibility symbol.
pub fn launch_worker(
    _config: WorkerLaunchConfig,
    _manifest_signing_key: &SigningKey,
) -> Result<SpawnedWorker, SandboxError> {
    Err(SandboxError::Enforcement(
        "KEL-bound worker launch is mandatory; use launch_worker_with_kel".into(),
    ))
}

/// Mandatory KEL-bound launch path used by klyn-daemon. A fresh journal is
/// created without overwrite, and the worker is not returned until the ring
/// challenge-response and KEL gate-clear event have both verified.
pub fn launch_worker_with_kel(
    config: WorkerLaunchConfig,
    manifest_signing_key: &SigningKey,
    journal_path: impl AsRef<Path>,
    session_id: [u8; 16],
) -> Result<SpawnedWorker, SandboxError> {
    let expected_session = kel::session_id_from_token_id(&config.capability.claims.token_id);
    if expected_session != session_id {
        return Err(SandboxError::Enforcement(
            "KEL session ID is not derived from the signed capability token ID".into(),
        ));
    }
    let journal = KelJournal::create(journal_path, manifest_signing_key, session_id)?.shared();
    launch_worker_inner(config, manifest_signing_key, Some(journal), None)
}

/// Launch a KEL-attested worker with a private scratch-only filesystem
/// transaction whose rollback is bound to cgroup and telemetry teardown.
pub fn launch_worker_with_kel_and_fs_transaction(
    config: WorkerLaunchConfig,
    manifest_signing_key: &SigningKey,
    journal_path: impl AsRef<Path>,
    session_id: [u8; 16],
    filesystem_transaction: SharedFsTransaction,
) -> Result<SpawnedWorker, SandboxError> {
    let expected_session = kel::session_id_from_token_id(&config.capability.claims.token_id);
    if expected_session != session_id {
        return Err(SandboxError::Enforcement(
            "KEL session ID is not derived from the signed capability token ID".into(),
        ));
    }
    let journal = KelJournal::create(journal_path, manifest_signing_key, session_id)?.shared();
    launch_worker_inner(
        config,
        manifest_signing_key,
        Some(journal),
        Some(filesystem_transaction),
    )
}

fn launch_worker_inner(
    config: WorkerLaunchConfig,
    manifest_signing_key: &SigningKey,
    kel_journal: Option<SharedKelJournal>,
    filesystem_transaction: Option<SharedFsTransaction>,
) -> Result<SpawnedWorker, SandboxError> {
    let init_executable = validate_trusted_init_executable(&config.init_executable)?;
    let worker_executable = validate_trusted_executable(&config.worker_executable)?;
    let worker_hash = sha256_file(&worker_executable)?;

    let key = manifest_signing_key.verifying_key();
    let capability_verifier = Ed25519CapabilityVerifier::new(manifest_signing_key.verifying_key());
    if let Err(error) = config.capability.claims.validate() {
        if let Some(journal) = &kel_journal {
            append_kel_event(
                journal,
                KelEventKind::CapabilityRejected,
                kel::hash_serializable(&config.capability)?,
            )?;
        }
        return Err(error);
    }
    if let Err(error) = capability_verifier.verify(&config.capability) {
        if let Some(journal) = &kel_journal {
            append_kel_event(
                journal,
                KelEventKind::CapabilityRejected,
                kel::hash_serializable(&config.capability)?,
            )?;
        }
        return Err(SandboxError::Enforcement(format!(
            "supervisor refused an invalid OCap signature: {error}"
        )));
    }
    let capability_hash = kel::hash_serializable(&config.capability)?;
    let session_id = kel::session_id_from_token_id(&config.capability.claims.token_id);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SandboxError::Enforcement("system clock is before Unix epoch".into()))?
        .as_secs();
    if config.capability.claims.expires_at_unix <= now {
        if let Some(journal) = &kel_journal {
            append_kel_event(journal, KelEventKind::CapabilityRejected, capability_hash)?;
        }
        return Err(SandboxError::Enforcement(
            "supervisor refused an expired OCap capability".into(),
        ));
    }
    if config.capability.claims.subject_uid == 0 {
        if let Some(journal) = &kel_journal {
            append_kel_event(journal, KelEventKind::CapabilityRejected, capability_hash)?;
        }
        return Err(SandboxError::InvalidConfig(
            "root UID cannot own an agent worker".into(),
        ));
    }
    if let Some(journal) = &kel_journal {
        if journal
            .lock()
            .map_err(|_| SandboxError::Enforcement("KEL journal lock is poisoned".into()))?
            .session_id()
            != session_id
        {
            return Err(SandboxError::Enforcement(
                "KEL journal session differs from the signed worker capability".into(),
            ));
        }
        append_kel_event(journal, KelEventKind::CapabilityValidated, capability_hash)?;
    }

    // Configure all limits before the process exists. This removes any window
    // in which a runnable child could inherit default cgroup resource controls.
    let cgroup = CgroupV2Boundary::create(
        &config.delegated_cgroup_root,
        &config.worker_id,
        &config.capability.claims.budget,
        config.cpu_weight,
    )?;
    let mut manifest = WorkerManifest {
        version: crate::manifest::WORKER_MANIFEST_VERSION,
        broker_socket: config.broker_socket,
        roots: config.roots,
        capability: config.capability,
        worker_executable_sha256: worker_hash.clone(),
        // The current seccomp profile prohibits direct exec; therefore the
        // active allow-list deliberately contains only the worker image itself.
        allowed_execution_binary_sha256: vec![worker_hash],
        landlock_abi: REQUIRED_LANDLOCK_ABI,
        max_open_fds: WORKER_MAX_OPEN_FDS,
        cgroup_path: cgroup.path().to_path_buf(),
        cpu_weight: config.cpu_weight,
        signature: Vec::new(),
    };
    crate::worker_bootstrap::validate_manifest_shape(&manifest)?;
    manifest.sign(manifest_signing_key)?;
    manifest.verify_signature(&key)?;
    let manifest_hash = kel::hash_serializable(&manifest)?;
    let executable_hash = kel::parse_sha256_hex(&manifest.worker_executable_sha256)?;
    manifest.verify_worker_executable(&worker_executable)?;
    let manifest_fd = manifest.seal_memfd(&key)?;

    // Create the data-plane rings only after the signed manifest and OCap have
    // been validated. Worker-side mappings are attached only after bootstrap
    // independently verifies the manifest and capability.
    let (mut command_ring, worker_command_fds) = RingProducer::create()?;
    let (mut response_ring, worker_response_fds) = RingConsumer::create()?;

    let (mut gate, child_gate) = StartGate::pair()?;
    let (mut policy_gate, child_policy_gate) = WorkerPolicyGate::pair()?;
    let manifest_source = duplicate_cloexec(manifest_fd.as_raw_fd())?;
    let gate_source = duplicate_cloexec(child_gate.as_raw_fd())?;
    let policy_gate_source = duplicate_cloexec(child_policy_gate.as_raw_fd())?;
    let manifest_source_fd = manifest_source.as_raw_fd();
    let gate_source_fd = gate_source.as_raw_fd();
    let policy_gate_source_fd = policy_gate_source.as_raw_fd();
    let command_ring_raw_fds = worker_command_fds.raw_fds();
    let response_ring_raw_fds = worker_response_fds.raw_fds();
    // Keep all source descriptors outside the fixed child target range so dup3
    // cannot overwrite a source needed by a later descriptor assignment.
    let command_payload_source = duplicate_cloexec_at_least(command_ring_raw_fds[0], 32)?;
    let command_head_source = duplicate_cloexec_at_least(command_ring_raw_fds[1], 32)?;
    let command_tail_source = duplicate_cloexec_at_least(command_ring_raw_fds[2], 32)?;
    let response_payload_source = duplicate_cloexec_at_least(response_ring_raw_fds[0], 32)?;
    let response_head_source = duplicate_cloexec_at_least(response_ring_raw_fds[1], 32)?;
    let response_tail_source = duplicate_cloexec_at_least(response_ring_raw_fds[2], 32)?;
    let command_payload_source_fd = command_payload_source.as_raw_fd();
    let command_head_source_fd = command_head_source.as_raw_fd();
    let command_tail_source_fd = command_tail_source.as_raw_fd();
    let response_payload_source_fd = response_payload_source.as_raw_fd();
    let response_head_source_fd = response_head_source.as_raw_fd();
    let response_tail_source_fd = response_tail_source.as_raw_fd();

    let mut command = Command::new(&init_executable);
    command
        .arg("--uid")
        .arg(manifest.capability.claims.subject_uid.to_string())
        .arg("--gid")
        .arg(manifest.capability.claims.subject_gid.to_string())
        .arg("--")
        .arg(&worker_executable)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // FD 4 is the sealed memfd, FD 5 gates stage-0, and FD 6 is the final
    // policy/mission gate. All other descriptors >= 3 are closed before exec;
    // close_range failure aborts spawn.
    unsafe {
        command.pre_exec(move || {
            if libc::dup3(manifest_source_fd, MANIFEST_FD, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::dup3(gate_source_fd, crate::start_gate::START_GATE_FD, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::dup3(
                policy_gate_source_fd,
                crate::start_gate::WORKER_POLICY_GATE_FD,
                0,
            ) < 0
            {
                return Err(io::Error::last_os_error());
            }
            for (source, target) in [
                (command_payload_source_fd, COMMAND_RING_PAYLOAD_FD),
                (command_head_source_fd, COMMAND_RING_HEAD_FD),
                (command_tail_source_fd, COMMAND_RING_TAIL_FD),
                (response_payload_source_fd, RESPONSE_RING_PAYLOAD_FD),
                (response_head_source_fd, RESPONSE_RING_HEAD_FD),
                (response_tail_source_fd, RESPONSE_RING_TAIL_FD),
            ] {
                if libc::dup3(source, target, 0) < 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            if libc::syscall(libc::SYS_close_range, 3u32, 3u32, 0u32) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::syscall(
                libc::SYS_close_range,
                (RESPONSE_RING_TAIL_FD + 1) as u32,
                u32::MAX,
                0u32,
            ) != 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = command.spawn()?;
    // Closing the supervisor's duplicate child endpoint is required; otherwise
    // a failed launcher would not observe EOF on the private gate channel.
    drop(child_gate);
    drop(child_policy_gate);
    drop(manifest_source);
    drop(gate_source);
    drop(policy_gate_source);
    drop(manifest_fd);
    drop(worker_command_fds);
    drop(worker_response_fds);
    drop(command_payload_source);
    drop(command_head_source);
    drop(command_tail_source);
    drop(response_payload_source);
    drop(response_head_source);
    drop(response_tail_source);

    let gate_result = (|| -> Result<WorkerTelemetry, SandboxError> {
        let cgroup_id = fs::metadata(cgroup.path())?.ino();
        gate.release_after_verification(&cgroup, child.id(), &manifest, &key)?;

        let mut spawn_payload = [0u8; 4 + 8 + 32 + 32];
        spawn_payload[..4].copy_from_slice(&child.id().to_le_bytes());
        spawn_payload[4..12].copy_from_slice(&cgroup_id.to_le_bytes());
        spawn_payload[12..44].copy_from_slice(&manifest_hash);
        spawn_payload[44..76].copy_from_slice(&executable_hash);
        if let Some(journal) = &kel_journal {
            append_kel_event(
                journal,
                KelEventKind::Spawn,
                kel::hash_payload(&spawn_payload),
            )?;
        }

        // Attach/initialize telemetry after Spawn is durably logged but before
        // sending the challenge or releasing the mission gate.
        let journal = kel_journal.clone().ok_or_else(|| {
            SandboxError::Enforcement("KEL journal is mandatory for worker telemetry".into())
        })?;
        let telemetry = match filesystem_transaction.clone() {
            Some(transaction) => WorkerTelemetry::start_with_kel_and_fs_transaction(
                cgroup.path(),
                child.id(),
                manifest.capability.claims.budget.clone(),
                journal,
                transaction,
            )?,
            None => WorkerTelemetry::start_with_kel(
                cgroup.path(),
                child.id(),
                manifest.capability.claims.budget.clone(),
                journal,
            )?,
        };

        // The worker is already policy-restricted and must answer the
        // challenge before it is allowed to send POLICY_READY.
        let challenge = KelAttestationChallenge {
            session_id,
            nonce: random_nonce()?,
            launcher_pid: child.id(),
            cgroup_id,
            manifest_hash,
            capability_hash,
            executable_hash,
            daemon_public_key: manifest_signing_key.verifying_key().to_bytes(),
        };
        let (challenge_digest, proof) =
            build_and_send_attestation(&mut command_ring, &mut response_ring, challenge)?;
        if let Some(journal) = &kel_journal {
            journal
                .lock()
                .map_err(|_| SandboxError::Enforcement("KEL journal lock is poisoned".into()))?
                .append_attestation(proof)?;
        }

        // Separate policy readiness from mission release so PolicyGateClear is
        // durably chained before the release byte lets the worker return to its
        // mission loop.
        policy_gate.verify_policy_ready(WORKER_BOOTSTRAP_TIMEOUT)?;
        if let Some(journal) = &kel_journal {
            journal
                .lock()
                .map_err(|_| SandboxError::Enforcement("KEL journal lock is poisoned".into()))?
                .append(KelEventKind::PolicyGateClear, challenge_digest)?;
        }
        policy_gate.release_verified_mission()?;
        Ok(telemetry)
    })();
    let telemetry = match gate_result {
        Ok(telemetry) => telemetry,
        Err(error) => {
            let _ = child.kill();
            let cleanup = cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT);
            if cleanup.is_ok() {
                rollback_shared_transaction_or_abort(&filesystem_transaction);
                if let Some(journal) = &kel_journal {
                    let path_hash = kel::hash_payload(cgroup.path().to_string_lossy().as_bytes());
                    let _ = journal.lock().map(|mut journal| {
                        let _ = journal.record_cgroup_destroyed(path_hash);
                    });
                }
                let _ = child.wait();
            } else {
                if let Some(transaction) = &filesystem_transaction {
                    match transaction.lock() {
                        Ok(transaction) => FsTransaction::abort_cleanup_failure(
                            Some(transaction.transaction_root()),
                            "startup failure left cgroup termination unconfirmed",
                        ),
                        Err(_) => FsTransaction::abort_cleanup_failure(
                            None,
                            "filesystem transaction lock poisoned after startup failure",
                        ),
                    }
                }
                let _ = child.try_wait();
            }
            return match cleanup {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                    "worker startup/attestation failed ({error}); cgroup cleanup also failed ({cleanup_error})"
                ))),
            };
        }
    };

    Ok(SpawnedWorker {
        child,
        cgroup,
        command_ring,
        response_ring,
        kel_journal,
        telemetry: Some(telemetry),
        filesystem_transaction,
    })
}

fn rollback_shared_transaction_or_abort(transaction: &Option<SharedFsTransaction>) {
    if let Some(transaction) = transaction {
        match transaction.lock() {
            Ok(mut transaction) => transaction.rollback_after_cgroup_empty_or_abort(),
            Err(_) => FsTransaction::abort_cleanup_failure(
                None,
                "filesystem transaction mutex was poisoned during startup rollback",
            ),
        }
    }
}

fn append_kel_event(
    journal: &SharedKelJournal,
    kind: KelEventKind,
    payload_hash: [u8; 32],
) -> Result<(), SandboxError> {
    journal
        .lock()
        .map_err(|_| SandboxError::Enforcement("KEL journal lock is poisoned".into()))?
        .append(kind, payload_hash)?;
    Ok(())
}

fn random_nonce() -> Result<[u8; 32], SandboxError> {
    let mut nonce = [0u8; 32];
    let mut filled = 0usize;
    while filled < nonce.len() {
        let result = unsafe {
            libc::getrandom(nonce[filled..].as_mut_ptr().cast(), nonce.len() - filled, 0)
        };
        if result > 0 {
            filled += result as usize;
            continue;
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::Interrupted {
            continue;
        }
        return Err(SandboxError::Io(error));
    }
    Ok(nonce)
}

fn build_and_send_attestation(
    command_ring: &mut RingProducer,
    response_ring: &mut RingConsumer,
    challenge: KelAttestationChallenge,
) -> Result<([u8; 32], kel::KelAttestationProof), SandboxError> {
    let mut frame = [0u8; KEL_CHALLENGE_FRAME_LEN];
    challenge.encode_frame(&mut frame);
    command_ring.push_wait(&frame, WORKER_BOOTSTRAP_TIMEOUT)?;

    let mut response = [0u8; KEL_RESPONSE_FRAME_LEN];
    {
        let frame = response_ring
            .wait_peek(Some(WORKER_BOOTSTRAP_TIMEOUT))?
            .ok_or_else(|| {
                SandboxError::Enforcement(
                    "worker did not answer the KEL shared-ring challenge".into(),
                )
            })?;
        if frame.payload().len() != KEL_RESPONSE_FRAME_LEN {
            return Err(SandboxError::Enforcement(
                "worker KEL attestation response has an invalid frame length".into(),
            ));
        }
        response.copy_from_slice(frame.payload());
        frame.consume()?;
    }

    let proof = challenge.verify_worker_response(&response)?;
    Ok((challenge.digest(), proof))
}

fn duplicate_cloexec(fd: RawFd) -> Result<OwnedFd, SandboxError> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 10) };
    if duplicate < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(duplicate) })
}

fn duplicate_cloexec_at_least(fd: RawFd, minimum: RawFd) -> Result<OwnedFd, SandboxError> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, minimum) };
    if duplicate < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(duplicate) })
}

fn validate_trusted_init_executable(path: impl AsRef<Path>) -> Result<PathBuf, SandboxError> {
    let canonical = fs::canonicalize(path.as_ref())?;
    if canonical.file_name() != Some(OsStr::new("klyn-sandbox-init")) {
        return Err(SandboxError::InvalidConfig(
            "stage-0 executable must be named klyn-sandbox-init".into(),
        ));
    }
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o111 == 0
        || metadata.mode() & 0o222 != 0
        || metadata.mode() & (libc::S_ISUID | libc::S_ISGID) != 0
    {
        return Err(SandboxError::InvalidConfig(
            "stage-0 executable must be a root-owned, executable, non-writable regular file".into(),
        ));
    }
    let mut file = File::open(&canonical)?;
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)
        .map_err(|_| SandboxError::InvalidConfig("stage-0 executable is truncated".into()))?;
    if magic != *b"\x7fELF" {
        return Err(SandboxError::InvalidConfig(
            "stage-0 launcher must be a native ELF executable".into(),
        ));
    }

    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory)?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(SandboxError::InvalidConfig(format!(
                "stage-0 executable has an unsafe parent directory: {}",
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
    fn stage0_path_must_be_a_fixed_trusted_binary_name() {
        assert!(validate_trusted_init_executable("/bin/sh").is_err());
        assert!(validate_trusted_init_executable("/definitely/not/klyn-sandbox-init").is_err());
    }

    #[test]
    fn binary_worker_response_parser_accepts_only_known_wire_shapes() {
        let ping = decode_worker_response(&[WORKER_RESP_PING, 7, 0, 0, 0, 1])
            .expect("well-formed ping response");
        assert_eq!(ping["ok"].as_bool(), Some(true));
        assert_eq!(ping["pid"].as_u64(), Some(7));
        assert_eq!(ping["namespace_init"].as_bool(), Some(true));

        let shutdown =
            decode_worker_response(&[WORKER_RESP_SHUTDOWN]).expect("well-formed shutdown response");
        assert_eq!(shutdown["ok"].as_bool(), Some(true));
        assert_eq!(shutdown["state"].as_str(), Some("stopping"));
    }

    #[test]
    fn binary_worker_response_parser_rejects_unknown_or_malformed_frames() {
        assert!(decode_worker_response(&[]).is_err());
        assert!(decode_worker_response(&[0xFF]).is_err());
        assert!(decode_worker_response(&[WORKER_RESP_PING, 1, 2]).is_err());
        assert!(decode_worker_response(&[WORKER_RESP_PING, 1, 0, 0, 0, 2]).is_err());
        assert!(decode_worker_response(&[WORKER_RESP_SHUTDOWN, 0]).is_err());
    }
}
