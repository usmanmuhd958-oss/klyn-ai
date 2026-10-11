//! User, mount, network, IPC and UTS namespace setup for trusted worker bootstraps.
//!
//! Call only after the daemon's start gate has held the process inside its
//! cgroup. Any unsupported namespace or UID/GID mapping is fatal: this module
//! never degrades to host-namespace execution.

use std::{
    fs,
    io::{self, Read, Write},
    os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
};

use nix::{
    mount::{mount, MsFlags},
    sched::{unshare, CloneFlags},
    unistd::{close, Gid, Uid},
};

use crate::SandboxError;

const WORKER_NAMESPACE_ID: u32 = 1000;
const START_GATE_MARKER: u8 = 0x4b;

/// Read one release byte from a private FIFO. The launch supervisor writes it
/// only after it has placed the child PID in the configured cgroup.
pub fn await_start_gate(path: impl AsRef<Path>) -> Result<(), SandboxError> {
    let path = path.as_ref();
    let before = fs::symlink_metadata(path)?;
    let euid = Uid::current().as_raw();
    if !before.file_type().is_fifo()
        || before.uid() != euid
        || before.mode() & 0o077 != 0
    {
        return Err(SandboxError::InvalidConfig(
            "start gate must be a private owner-controlled FIFO".into(),
        ));
    }

    let mut gate = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let after = gate.metadata()?;
    if !after.file_type().is_fifo()
        || after.uid() != euid
        || after.ino() != before.ino()
        || after.dev() != before.dev()
    {
        return Err(SandboxError::Enforcement(
            "start gate identity changed during open".into(),
        ));
    }

    let mut marker = [0u8; 1];
    gate.read_exact(&mut marker)?;
    if marker[0] != START_GATE_MARKER {
        return Err(SandboxError::Enforcement(
            "start gate release marker is invalid".into(),
        ));
    }
    Ok(())
}

/// Enter private user/mount/network/IPC/UTS namespaces and disable mount
/// propagation. The process is remapped to UID/GID 1000 inside its user
/// namespace while retaining its original host identity for peer credentials.
pub fn enter_worker_namespaces() -> Result<(), SandboxError> {
    let host_uid = Uid::current().as_raw();
    let host_gid = Gid::current().as_raw();

    unshare(CloneFlags::CLONE_NEWUSER).map_err(|e| {
        SandboxError::Enforcement(format!("unshare user namespace failed: {e}"))
    })?;

    // The kernel requires setgroups to be disabled before an unprivileged
    // caller writes a GID mapping. Any mapping failure aborts this worker.
    fs::write("/proc/self/setgroups", "deny\n")
        .map_err(|e| SandboxError::Enforcement(format!("disable setgroups failed: {e}")))?;
    fs::write(
        "/proc/self/uid_map",
        format!("{WORKER_NAMESPACE_ID} {host_uid} 1\n"),
    )
    .map_err(|e| SandboxError::Enforcement(format!("write UID map failed: {e}")))?;
    fs::write(
        "/proc/self/gid_map",
        format!("{WORKER_NAMESPACE_ID} {host_gid} 1\n"),
    )
    .map_err(|e| SandboxError::Enforcement(format!("write GID map failed: {e}")))?;

    unshare(
        CloneFlags::CLONE_NEWNS
            | CloneFlags::CLONE_NEWNET
            | CloneFlags::CLONE_NEWIPC
            | CloneFlags::CLONE_NEWUTS,
    )
    .map_err(|e| SandboxError::Enforcement(format!("unshare worker namespaces failed: {e}")))?;

    mount(
        None::<&str>,
        Path::new("/"),
        None::<&str>,
        MsFlags::MS_REC | MsFlags::MS_PRIVATE,
        None::<&str>,
    )
    .map_err(|e| SandboxError::Enforcement(format!("make mounts private failed: {e}")))?;

    Ok(())
}

/// Close inherited host descriptors before the broker connection is created.
/// Must be called in the single-threaded bootstrap before any untrusted code.
/// Standard streams are kept; descriptors 3 and 4 are closed so the broker is
/// deliberately reconnected into reserved FD 3 after this sweep.
pub fn close_inherited_descriptors() -> Result<(), SandboxError> {
    let descriptors = fs::read_dir("/proc/self/fd")?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_string_lossy().parse::<i32>().ok())
        .filter(|fd| *fd >= 3)
        .collect::<Vec<_>>();

    for fd in descriptors {
        match close(fd) {
            Ok(()) => {}
            Err(nix::errno::Errno::EBADF) => {}
            Err(error) => {
                return Err(SandboxError::Enforcement(format!(
                    "close inherited descriptor {fd} failed: {error}"
                )));
            }
        }
    }
    Ok(())
}

pub(crate) fn release_marker() -> u8 {
    START_GATE_MARKER
}

pub(crate) fn set_private_fifo(path: &Path) -> Result<(), SandboxError> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_fifo() || metadata.mode() & 0o077 != 0 {
        return Err(SandboxError::Enforcement(
            "created start gate is not a private FIFO".into(),
        ));
    }
    Ok(())
}

pub(crate) fn write_release(path: &Path) -> Result<(), SandboxError> {
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
        .open(path)?;
    writer.write_all(&[START_GATE_MARKER])?;
    writer.flush()?;
    Ok(())
}

pub(crate) fn is_no_reader(error: &io::Error) -> bool {
    error.raw_os_error() == Some(nix::errno::Errno::ENXIO as i32)
}
