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
    process::{Child, Command, ExitStatus},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::SigningKey;

use crate::{
    broker::{CapabilityVerifier, Ed25519CapabilityVerifier},
    cgroup::CgroupV2Boundary,
    manifest::{sha256_file, WorkerManifest, REQUIRED_LANDLOCK_ABI, WORKER_MAX_OPEN_FDS},
    start_gate::StartGate,
    validate_trusted_executable, SandboxError, SignedCapability, MANIFEST_FD,
};

const WORKER_LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(3);

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
}

impl SpawnedWorker {
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn cgroup_path(&self) -> &Path {
        self.cgroup.path()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, SandboxError> {
        Ok(self.child.try_wait()?)
    }

    pub fn wait(&mut self) -> Result<ExitStatus, SandboxError> {
        let status = self.child.wait()?;
        self.cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT)?;
        Ok(status)
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

/// Launch one worker under the full supervisor-to-worker security lifecycle.
pub fn launch_worker(
    config: WorkerLaunchConfig,
    manifest_signing_key: &SigningKey,
) -> Result<SpawnedWorker, SandboxError> {
    let init_executable = validate_trusted_init_executable(&config.init_executable)?;
    let worker_executable = validate_trusted_executable(&config.worker_executable)?;
    let worker_hash = sha256_file(&worker_executable)?;

    let key = manifest_signing_key.verifying_key();
    let capability_verifier = Ed25519CapabilityVerifier::new(key.clone());
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

    let (mut gate, child_gate) = StartGate::pair()?;
    let manifest_source = duplicate_cloexec(manifest_fd.as_raw_fd())?;
    let gate_source = duplicate_cloexec(child_gate.as_raw_fd())?;
    let manifest_source_fd = manifest_source.as_raw_fd();
    let gate_source_fd = gate_source.as_raw_fd();

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
        .env("LANG", "C");

    // FD 4 is the sealed memfd and FD 5 is the private gate socket. All other
    // descriptors >= 3 are closed before exec; close_range failure aborts spawn.
    unsafe {
        command.pre_exec(move || {
            if libc::dup3(manifest_source_fd, MANIFEST_FD, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::dup3(gate_source_fd, crate::start_gate::START_GATE_FD, 0) < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::syscall(libc::SYS_close_range, 3u32, 3u32, 0u32) != 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::syscall(libc::SYS_close_range, 6u32, u32::MAX, 0u32) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut child = command.spawn()?;
    // Closing the supervisor's duplicate child endpoint is required; otherwise
    // a failed launcher would not observe EOF on the private gate channel.
    drop(child_gate);
    drop(manifest_source);
    drop(gate_source);
    drop(manifest_fd);

    if let Err(error) = gate.release_after_verification(&cgroup, child.id(), &manifest, &key) {
        let _ = child.kill();
        let _ = child.wait();
        let cleanup = cgroup.terminate_and_wait(WORKER_LIFECYCLE_TIMEOUT);
        return match cleanup {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(SandboxError::Enforcement(format!(
                "worker start gate failed ({error}); cgroup cleanup also failed ({cleanup_error})"
            ))),
        };
    }

    Ok(SpawnedWorker { child, cgroup })
}

fn duplicate_cloexec(fd: RawFd) -> Result<OwnedFd, SandboxError> {
    let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 10) };
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
}
