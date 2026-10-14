//! Private per-worker filesystem transaction workspaces.
//!
//! The workspace is scratch-only: the active candidate tree is never mounted
//! or granted write access. Worker mutations are mediated by the capability
//! broker and confined to this private root. Once the cgroup is empty, broker
//! admission is stopped before the transaction tree is discarded.

use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use std::os::unix::{
    ffi::OsStrExt,
    fs::{DirBuilderExt, MetadataExt, PermissionsExt},
};

use crate::SandboxError;

const BROKER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub type SharedFsTransaction = Arc<Mutex<FsTransaction>>;

pub struct FsTransaction {
    transaction_root: PathBuf,
    workspace: PathBuf,
    parent: PathBuf,
    rolled_back: bool,
    broker_shutdown: Option<(Arc<AtomicBool>, Arc<AtomicBool>)>,
}

impl FsTransaction {
    /// Create an exclusive, owner-only transaction directory and workspace.
    /// The label is operator-generated and is never accepted from the worker.
    pub fn create(parent: impl AsRef<Path>, label: &str) -> Result<Self, SandboxError> {
        validate_label(label)?;
        let parent = fs::canonicalize(parent)?;
        let metadata = fs::metadata(&parent)?;
        if !metadata.is_dir() || metadata.mode() & 0o077 != 0 {
            return Err(SandboxError::InvalidConfig(
                "filesystem transaction parent must be private (mode 0700)".into(),
            ));
        }

        let transaction_root = parent.join(format!("klyn-fstxn-{label}"));
        let workspace = transaction_root.join("workspace");
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(&transaction_root)?;

        let creation = (|| -> io::Result<()> {
            builder.create(&workspace)?;
            fs::set_permissions(&transaction_root, fs::Permissions::from_mode(0o700))?;
            fs::set_permissions(&workspace, fs::Permissions::from_mode(0o700))?;
            File::open(&workspace)?.sync_all()?;
            File::open(&transaction_root)?.sync_all()?;
            File::open(&parent)?.sync_all()?;
            Ok(())
        })();

        if let Err(error) = creation {
            if let Err(cleanup) = fs::remove_dir_all(&transaction_root) {
                Self::abort_cleanup_failure(
                    Some(&transaction_root),
                    &format!("creation failed ({error}); cleanup also failed ({cleanup})"),
                );
            }
            return Err(SandboxError::Io(error));
        }

        Ok(Self {
            transaction_root,
            workspace,
            parent,
            rolled_back: false,
            broker_shutdown: None,
        })
    }

    pub fn shared(self) -> SharedFsTransaction {
        Arc::new(Mutex::new(self))
    }

    pub fn workspace_path(&self) -> &Path {
        &self.workspace
    }

    pub fn transaction_root(&self) -> &Path {
        &self.transaction_root
    }

    /// The broker thread sets stopped only after it has drained and joined
    /// every serving thread. Rollback waits for that acknowledgement.
    pub fn register_broker_shutdown(
        &mut self,
        stop: Arc<AtomicBool>,
        stopped: Arc<AtomicBool>,
    ) {
        self.broker_shutdown = Some((stop, stopped));
    }

    /// Stop broker admission and discard files, but only after the supervisor
    /// has independently confirmed that the complete cgroup-v2 leaf is empty.
    pub fn rollback_after_cgroup_empty(&mut self) -> Result<(), SandboxError> {
        if let Some((stop, stopped)) = &self.broker_shutdown {
            stop.store(true, Ordering::Release);
            let deadline = Instant::now()
                .checked_add(BROKER_SHUTDOWN_TIMEOUT)
                .ok_or_else(|| {
                    SandboxError::Enforcement("filesystem rollback deadline overflow".into())
                })?;
            while !stopped.load(Ordering::Acquire) {
                if Instant::now() >= deadline {
                    return Err(SandboxError::Enforcement(
                        "broker did not stop before filesystem rollback deadline".into(),
                    ));
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        self.rollback()
    }

    /// Remove the complete private transaction. remove_dir_all does not follow
    /// symlinks; lstat validation prevents replacement of the root directory.
    pub fn rollback(&mut self) -> Result<(), SandboxError> {
        if self.rolled_back {
            return Ok(());
        }

        match fs::symlink_metadata(&self.transaction_root) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(SandboxError::Enforcement(
                        "filesystem transaction root was replaced by a non-directory".into(),
                    ));
                }
                fs::remove_dir_all(&self.transaction_root)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(SandboxError::Io(error)),
        }

        File::open(&self.parent)?.sync_all()?;
        self.rolled_back = true;
        Ok(())
    }

    /// Cleanup failures are fatal. Try forced/detached unmount before aborting
    /// to prevent a future mount-backed variant exposing partial state.
    pub fn rollback_after_cgroup_empty_or_abort(&mut self) {
        if let Err(error) = self.rollback_after_cgroup_empty() {
            Self::abort_cleanup_failure(
                Some(&self.transaction_root),
                &format!("fail-closed filesystem rollback failed: {error}"),
            );
        }
    }

    pub fn abort_cleanup_failure(path: Option<&Path>, reason: &str) -> ! {
        #[cfg(target_os = "linux")]
        if let Some(path) = path {
            use std::ffi::CString;
            if let Ok(path) = CString::new(path.as_os_str().as_bytes()) {
                // SAFETY: path is NUL-terminated and valid for this syscall.
                let _ = unsafe { libc::umount2(path.as_ptr(), libc::MNT_DETACH | libc::MNT_FORCE) };
            }
        }
        eprintln!("klyn-sandbox: fatal filesystem transaction cleanup failure: {reason}");
        std::process::abort()
    }
}

impl Drop for FsTransaction {
    fn drop(&mut self) {
        if !self.rolled_back {
            self.rollback_after_cgroup_empty_or_abort();
        }
    }
}

fn validate_label(label: &str) -> Result<(), SandboxError> {
    if label.is_empty()
        || label.len() > 64
        || !label.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SandboxError::InvalidConfig(
            "filesystem transaction label must be 1..=64 safe ASCII bytes".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn rollback_removes_nested_artifacts_without_following_symlinks() {
        let parent = tempfile::tempdir().expect("private transaction parent");
        let outside = tempfile::tempdir().expect("outside sentinel parent");
        let sentinel = outside.path().join("must-survive.txt");
        fs::write(&sentinel, b"outside transaction").expect("write outside sentinel");

        let mut transaction = FsTransaction::create(parent.path(), "rollback-artifacts")
            .expect("create transaction");
        let workspace = transaction.workspace_path().to_path_buf();
        fs::create_dir(workspace.join("nested")).expect("create nested directory");
        fs::write(workspace.join("nested/artifact.db"), b"ephemeral mutation")
            .expect("write nested artifact");
        fs::write(workspace.join("uncommitted.txt"), b"not committed")
            .expect("write scratch artifact");
        symlink(&sentinel, workspace.join("outside-link")).expect("create outside symlink");

        transaction.rollback().expect("rollback transaction");
        assert!(!workspace.exists(), "workspace survived rollback");
        assert!(!transaction.transaction_root().exists(), "transaction root survived rollback");
        assert_eq!(fs::read(&sentinel).expect("read outside sentinel"), b"outside transaction");
    }

    #[test]
    fn rollback_is_idempotent_and_leaves_no_residual_files() {
        let parent = tempfile::tempdir().expect("private transaction parent");
        let mut transaction = FsTransaction::create(parent.path(), "forced-termination")
            .expect("create transaction");
        let workspace = transaction.workspace_path().to_path_buf();
        fs::write(workspace.join("worker-output.bin"), [0x5a; 64]).expect("create output");
        transaction.rollback_after_cgroup_empty().expect("rollback");
        transaction.rollback().expect("idempotent rollback");
        assert!(!workspace.exists(), "worker artifact survived");
        assert_eq!(fs::read_dir(parent.path()).expect("read parent").count(), 0);
    }

    #[test]
    fn transaction_label_rejects_paths_and_ambiguous_names() {
        assert!(validate_label("").is_err());
        assert!(validate_label("../escape").is_err());
        assert!(validate_label("worker/name").is_err());
        assert!(validate_label(".").is_err());
        assert!(validate_label(&"a".repeat(65)).is_err());
        assert!(validate_label("worker-123-ab").is_ok());
    }

    #[test]
    fn broker_shutdown_is_required_before_workspace_removal() {
        let parent = tempfile::tempdir().expect("private transaction parent");
        let mut transaction =
            FsTransaction::create(parent.path(), "broker-order").expect("create transaction");
        fs::write(transaction.workspace_path().join("file"), b"data").expect("write file");
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));
        transaction.register_broker_shutdown(Arc::clone(&stop), Arc::clone(&stopped));
        let thread_stop = Arc::clone(&stop);
        let thread_stopped = Arc::clone(&stopped);
        let thread = thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            thread_stopped.store(true, Ordering::Release);
        });
        transaction.rollback_after_cgroup_empty().expect("stop broker then rollback");
        thread.join().expect("join broker simulation");
        assert!(stop.load(Ordering::Acquire));
        assert!(!transaction.workspace_path().exists());
    }
}
