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
    ipc_ring::{
        RingConsumer, RingProducer, COMMAND_RING_HEAD_FD, COMMAND_RING_PAYLOAD_FD,
        COMMAND_RING_TAIL_FD, RESPONSE_RING_HEAD_FD, RESPONSE_RING_PAYLOAD_FD,
        RESPONSE_RING_TAIL_FD, WORKER_CMD_PING, WORKER_CMD_SHUTDOWN, WORKER_RESP_PING,
        WORKER_RESP_SHUTDOWN,
    },
    manifest::{sha256_file, WorkerManifest, REQUIRED_LANDLOCK_ABI, WORKER_MAX_OPEN_FDS},
    start_gate::{StartGate, WorkerPolicyGate},
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
}

impl Drop for SpawnedWorker {
    fn drop(&mut self) {
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
            let _ = self.child.wait();
        } else {
            // Best-effort nonblocking reap if kernel cleanup itself failed.
            // Explicit terminate()/wait() report cleanup errors to the caller.
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
                self.cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT)?;
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
        let _ = self.child.kill();
        self.cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT)?;
        let _ = self.child.wait();
        Ok(())
    }
}

fn decode_worker_response(bytes: &[u8]) -> Result<serde_json::Value, SandboxError> {
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

/// Launch one worker under the full supervisor-to-worker security lifecycle.
pub fn launch_worker(
    config: WorkerLaunchConfig,
    manifest_signing_key: &SigningKey,
) -> Result<SpawnedWorker, SandboxError> {
    let init_executable = validate_trusted_init_executable(&config.init_executable)?;
    let worker_executable = validate_trusted_executable(&config.worker_executable)?;
    let worker_hash = sha256_file(&worker_executable)?;

    let key = manifest_signing_key.verifying_key();
    let capability_verifier = Ed25519CapabilityVerifier::new(manifest_signing_key.verifying_key());
    config.capability.claims.validate()?;
    capability_verifier
        .verify(&config.capability)
        .map_err(|error| {
            SandboxError::Enforcement(format!(
                "supervisor refused an invalid OCap signature: {error}"
            ))
        })?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SandboxError::Enforcement("system clock is before Unix epoch".into()))?
        .as_secs();
    if config.capability.claims.expires_at_unix <= now {
        return Err(SandboxError::Enforcement(
            "supervisor refused an expired OCap capability".into(),
        ));
    }
    if config.capability.claims.subject_uid == 0 {
        return Err(SandboxError::InvalidConfig(
            "root UID cannot own an agent worker".into(),
        ));
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
    manifest.verify_worker_executable(&worker_executable)?;
    let manifest_fd = manifest.seal_memfd(&key)?;

    // Create the data-plane rings only after the signed manifest and OCap have
    // been validated. Worker-side mappings are attached only after bootstrap
    // independently verifies the manifest and capability.
    let (command_ring, worker_command_fds) = RingProducer::create()?;
    let (response_ring, worker_response_fds) = RingConsumer::create()?;

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

    let gate_result = gate
        .release_after_verification(&cgroup, child.id(), &manifest, &key)
        .and_then(|()| policy_gate.verify_policy_and_release(WORKER_BOOTSTRAP_TIMEOUT));
    if let Err(error) = gate_result {
        let _ = child.kill();
        let cleanup = cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT);
        if cleanup.is_ok() {
            let _ = child.wait();
        } else {
            // Do not allow a failed startup path to block indefinitely on a
            // process the kernel could not confirm as terminated.
            let _ = child.try_wait();
        }
        return match cleanup {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                "worker start gate failed ({error}); cgroup cleanup also failed ({cleanup_error})"
            ))),
        };
    }

    Ok(SpawnedWorker {
        child,
        cgroup,
        command_ring,
        response_ring,
    })
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

        let shutdown = decode_worker_response(&[WORKER_RESP_SHUTDOWN])
            .expect("well-formed shutdown response");
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
