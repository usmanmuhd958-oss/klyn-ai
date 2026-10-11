//! Cgroup-before-release process launcher for trusted worker bootstrap binaries.

use std::{
    ffi::OsString,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

use nix::{sys::stat::Mode, unistd::mkfifo};

use crate::{
    namespace::{is_no_reader, release_marker, set_private_fifo},
    validate_cgroup_id, validate_trusted_executable, CgroupV2, ResourceBudget, SandboxError,
};

pub const DEFAULT_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug)]
pub struct WorkerLaunchSpec {
    /// A trusted bootstrap executable, not a model-generated command.
    pub executable: PathBuf,
    /// Arguments must be constructed by trusted daemon/runtime code.
    pub args: Vec<OsString>,
    /// Private daemon-owned directory for FIFO start gates.
    pub gate_directory: PathBuf,
    /// An actually delegated cgroup-v2 subtree with required controllers enabled.
    pub cgroup_root: PathBuf,
    pub cgroup_id: String,
    pub budget: ResourceBudget,
    pub startup_timeout: Duration,
}

/// Launch result owns the child and its resource group. Dropping it kills the
/// group and reaps the direct child on a best-effort basis.
pub struct SandboxedChild {
    child: Child,
    cgroup: CgroupV2,
    gate_path: PathBuf,
}

pub fn launch_gated_worker(spec: WorkerLaunchSpec) -> Result<SandboxedChild, SandboxError> {
    if spec.startup_timeout.is_zero() || spec.startup_timeout > MAX_STARTUP_TIMEOUT {
        return Err(SandboxError::InvalidConfig(
            "startup timeout must be between 1ms and 30s".into(),
        ));
    }
    validate_cgroup_id(&spec.cgroup_id)?;
    let executable = validate_trusted_executable(&spec.executable)?;

    prepare_private_directory(&spec.gate_directory)?;
    let gate_directory = fs::canonicalize(&spec.gate_directory)?;
    let gate_path = gate_directory.join(format!("{}.fifo", spec.cgroup_id));
    match fs::symlink_metadata(&gate_path) {
        Ok(_) => {
            return Err(SandboxError::InvalidConfig(
                "start gate path already exists".into(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(SandboxError::Io(error)),
    }

    let cgroup = CgroupV2::create(&spec.cgroup_root, &spec.cgroup_id, &spec.budget)?;
    mkfifo(&gate_path, Mode::S_IRUSR | Mode::S_IWUSR)
        .map_err(|e| SandboxError::Enforcement(format!("create start gate failed: {e}")))?;
    if let Err(error) = set_private_fifo(&gate_path) {
        let _ = fs::remove_file(&gate_path);
        return Err(error);
    }

    // No inherited environment is forwarded. In particular LD_PRELOAD,
    // LD_LIBRARY_PATH, PATH, shell startup variables and caller-provided
    // preload hooks cannot alter the trusted bootstrap before its gate.
    let mut command = Command::new(&executable);
    command
        .args(&spec.args)
        .env_clear()
        .env("KLYN_START_GATE_PATH", &gate_path)
        .env("KLYN_SANDBOX_REQUIRED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&gate_path);
            return Err(SandboxError::Io(error));
        }
    };

    if let Err(error) = cgroup.attach_pid(child.id()) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = cgroup.kill_all();
        let _ = fs::remove_file(&gate_path);
        return Err(error);
    }

    let deadline = Instant::now() + spec.startup_timeout;
    loop {
        match open_gate_writer(&gate_path) {
            Ok(mut writer) => {
                use std::io::Write;
                if let Err(error) = writer.write_all(&[release_marker()]) {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = cgroup.kill_all();
                    let _ = fs::remove_file(&gate_path);
                    return Err(SandboxError::Io(error));
                }
                drop(writer);
                break;
            }
            Err(error) if is_no_reader(&error) => {
                if let Some(status) = child.try_wait()? {
                    let _ = fs::remove_file(&gate_path);
                    return Err(SandboxError::Enforcement(format!(
                        "trusted bootstrap exited before start-gate rendezvous: {status}"
                    )));
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = cgroup.kill_all();
                    let _ = fs::remove_file(&gate_path);
                    return Err(SandboxError::Enforcement(
                        "trusted bootstrap did not reach the start gate before timeout".into(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = cgroup.kill_all();
                let _ = fs::remove_file(&gate_path);
                return Err(SandboxError::Io(error));
            }
        }
    }

    // The FIFO is no longer required after the release marker has been sent.
    let _ = fs::remove_file(&gate_path);
    Ok(SandboxedChild {
        child,
        cgroup,
        gate_path,
    })
}

impl SandboxedChild {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, SandboxError> {
        let status = self.child.try_wait()?;
        if status.is_some() {
            self.cgroup.kill_all()?;
        }
        Ok(status)
    }

    pub fn wait(&mut self) -> Result<ExitStatus, SandboxError> {
        let status = self.child.wait()?;
        // A bootstrap must not leave background tasks in the cgroup after its
        // controlling process exits.
        self.cgroup.kill_all()?;
        Ok(status)
    }

    pub fn terminate(&mut self) -> Result<(), SandboxError> {
        let group_result = self.cgroup.kill_all();
        let child_result = self.child.kill();
        let wait_result = self.child.wait();
        group_result?;
        if let Err(error) = child_result {
            if error.kind() != std::io::ErrorKind::InvalidInput {
                return Err(SandboxError::Io(error));
            }
        }
        wait_result?;
        Ok(())
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        let _ = self.cgroup.kill_all();
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        let _ = fs::remove_file(&self.gate_path);
    }
}

fn prepare_private_directory(path: &Path) -> Result<(), SandboxError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(SandboxError::InvalidConfig(
                "start gate directory must not be a symlink".into(),
            ));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(SandboxError::InvalidConfig(
                "start gate path is not a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(path)?,
        Err(error) => return Err(SandboxError::Io(error)),
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    let metadata = fs::metadata(path)?;
    let euid = nix::unistd::geteuid().as_raw();
    if metadata.mode() & 0o077 != 0 || (metadata.uid() != 0 && metadata.uid() != euid) {
        return Err(SandboxError::InvalidConfig(
            "start gate directory is not private to the daemon".into(),
        ));
    }
    Ok(())
}

fn open_gate_writer(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)
}
