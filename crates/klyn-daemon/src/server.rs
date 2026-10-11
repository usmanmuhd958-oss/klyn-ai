//! Linux Unix-domain-socket server with bounded framing and peer credentials.

use std::{
    fs,
    io::{self, BufReader},
    os::{
        linux::fs::MetadataExt as LinuxMetadataExt,
        unix::{
            fs::{FileTypeExt, MetadataExt, PermissionsExt},
            net::{UnixListener, UnixStream},
            ffi::OsStrExt,
        },
    },
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use klyn_protocol::{
    decode_request, read_frame, write_response, FrameError, Response, RpcErrorCode,
    MAX_FRAME_BYTES,
};
use nix::sys::socket::{getsockopt, sockopt::PeerCredentials};
use thiserror::Error;

use crate::{
    lifecycle::{ConnectionLease, Lifecycle, LifecycleError, LifecycleState},
    policy::PeerIdentity,
    Router,
};

const MAX_CONNECTION_THREADS: usize = 64;
static NEXT_WORKER_ID: AtomicU64 = AtomicU64::new(1);
const MAX_UNIX_SOCKET_PATH_BYTES: usize = 107;

#[derive(Debug, Error)]
pub enum DaemonError {
    #[error("daemon I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("peer credentials could not be verified")]
    PeerCredentials,
    #[error("IPC framing failed: {0}")]
    Frame(#[from] FrameError),
    #[error("lifecycle transition failed: {0}")]
    Lifecycle(#[from] LifecycleError),
    #[error("socket path already exists; refusing to replace it")]
    SocketPathExists,
    #[error("socket path is invalid or too long")]
    InvalidSocketPath,
    #[error("socket parent directory is writable by group or other users")]
    InsecureSocketDirectory,
    #[error("daemon worker thread could not be started")]
    WorkerSpawn,
    #[error("daemon worker thread panicked")]
    WorkerPanicked,
    #[error("daemon failed while serving requests")]
    LifecycleFailed,
}

/// Owns the bound socket. Drop removes the path only if it is still the exact
/// socket inode created here; stale or replaced paths are never blindly unlinked.
pub struct BoundSocket {
    listener: UnixListener,
    path: PathBuf,
    device: u64,
    inode: u64,
}

impl BoundSocket {
    pub fn bind(path: impl AsRef<Path>) -> Result<Self, DaemonError> {
        let path = path.as_ref();
        let file_name = path.file_name().ok_or(DaemonError::InvalidSocketPath)?;
        let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let canonical_parent = fs::canonicalize(parent)?;
        let parent_metadata = fs::metadata(&canonical_parent)?;
        if !parent_metadata.is_dir() {
            return Err(DaemonError::InvalidSocketPath);
        }
        if parent_metadata.mode() & 0o022 != 0 {
            return Err(DaemonError::InsecureSocketDirectory);
        }

        let socket_path = canonical_parent.join(file_name);
        if socket_path.as_os_str().as_bytes().len() > MAX_UNIX_SOCKET_PATH_BYTES {
            return Err(DaemonError::InvalidSocketPath);
        }
        match fs::symlink_metadata(&socket_path) {
            Ok(_) => return Err(DaemonError::SocketPathExists),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(DaemonError::Io(error)),
        }

        let listener = UnixListener::bind(&socket_path)?;
        let metadata = fs::symlink_metadata(&socket_path)?;
        if !metadata.file_type().is_socket() {
            return Err(DaemonError::InvalidSocketPath);
        }
        let device = metadata.dev();
        let inode = metadata.ino();

        if let Err(error) = fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)) {
            remove_socket_if_owned(&socket_path, device, inode);
            return Err(DaemonError::Io(error));
        }

        Ok(Self {
            listener,
            path: socket_path,
            device,
            inode,
        })
    }
}

impl Drop for BoundSocket {
    fn drop(&mut self) {
        remove_socket_if_owned(&self.path, self.device, self.inode);
    }
}

fn remove_socket_if_owned(path: &Path, device: u64, inode: u64) {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_socket() && metadata.dev() == device && metadata.ino() == inode {
            let _ = fs::remove_file(path);
        }
    }
}

pub fn serve(
    socket: BoundSocket,
    router: Arc<Router>,
    drain_timeout: Duration,
) -> Result<(), DaemonError> {
    let lifecycle = router.lifecycle();
    socket.listener.set_nonblocking(true)?;
    lifecycle.mark_ready()?;

    let mut workers: Vec<JoinHandle<()>> = Vec::new();

    loop {
        match lifecycle.snapshot()?.state {
            LifecycleState::Ready => {}
            LifecycleState::Draining => break,
            LifecycleState::Failed => return Err(DaemonError::LifecycleFailed),
            LifecycleState::Starting => return Err(DaemonError::Lifecycle(LifecycleError::NotReady)),
            LifecycleState::Stopped => return Ok(()),
        }

        match socket.listener.accept() {
            Ok((stream, _address)) => {
                reap_finished_workers(&mut workers, &lifecycle)?;
                if workers.len() >= MAX_CONNECTION_THREADS {
                    // Backpressure: drop new connections instead of allocating
                    // unbounded threads. No request is dispatched.
                    drop(stream);
                    continue;
                }

                let worker_router = Arc::clone(&router);
                let worker_id = NEXT_WORKER_ID.fetch_add(1, Ordering::Relaxed);
                let handle = thread::Builder::new()
                    .name(format!("klyn-ipc-{worker_id}"))
                    .spawn(move || {
                        let _ = serve_connection(stream, &worker_router);
                    })
                    .map_err(|_| DaemonError::WorkerSpawn)?;
                workers.push(handle);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                let _ = lifecycle.fail("Unix listener accept failed");
                return Err(DaemonError::Io(error));
            }
        }
    }

    let drain_result = lifecycle.complete_shutdown(drain_timeout);
    if drain_result.is_ok() {
        for worker in workers {
            if worker.join().is_err() {
                let _ = lifecycle.fail("IPC worker panicked");
                return Err(DaemonError::WorkerPanicked);
            }
        }
    }
    // On drain timeout, dropping JoinHandles detaches workers. The lifecycle is
    // Failed, so no new request can be dispatched; privileged work belongs in
    // the separately supervised sandbox process, not these IPC threads.
    drop(socket);
    drain_result?;
    Ok(())
}

fn reap_finished_workers(
    workers: &mut Vec<JoinHandle<()>>,
    lifecycle: &Lifecycle,
) -> Result<(), DaemonError> {
    let mut index = 0;
    while index < workers.len() {
        if workers[index].is_finished() {
            let worker = workers.remove(index);
            if worker.join().is_err() {
                let _ = lifecycle.fail("IPC worker panicked");
                return Err(DaemonError::WorkerPanicked);
            }
        } else {
            index += 1;
        }
    }
    Ok(())
}

pub fn serve_connection(stream: UnixStream, router: &Router) -> Result<(), DaemonError> {
    let _connection_lease = match router.lifecycle().begin_connection() {
        Ok(lease) => lease,
        Err(LifecycleError::ShuttingDown) => return Ok(()),
        Err(error) => return Err(DaemonError::Lifecycle(error)),
    };

    let peer = peer_identity(&stream)?;
    let mut reader = BufReader::new(stream);

    let frame = match read_frame(&mut reader) {
        Ok(frame) => frame,
        Err(FrameError::TooLarge) => {
            let response = Response::failure(
                None,
                RpcErrorCode::FrameTooLarge,
                "IPC frame exceeds the configured limit",
            );
            write_response(reader.get_mut(), &response)?;
            return Ok(());
        }
        Err(FrameError::Empty | FrameError::Unterminated) => {
            let response = Response::failure(None, RpcErrorCode::InvalidRequest, "invalid request");
            write_response(reader.get_mut(), &response)?;
            return Ok(());
        }
        Err(FrameError::Io(error)) => return Err(DaemonError::Io(error)),
        Err(error) => return Err(DaemonError::Frame(error)),
    };

    let request = match decode_request(&frame) {
        Ok(request) => request,
        Err(_) => {
            let response = Response::failure(None, RpcErrorCode::InvalidRequest, "invalid request");
            write_response(reader.get_mut(), &response)?;
            return Ok(());
        }
    };

    let (response, request_lease) = router.dispatch_with_lease(request, peer);
    let write_result = write_response(reader.get_mut(), &response).map_err(DaemonError::Frame);
    drop(request_lease);
    write_result?;
    Ok(())
}

fn peer_identity(stream: &UnixStream) -> Result<PeerIdentity, DaemonError> {
    let credentials =
        getsockopt(stream, PeerCredentials).map_err(|_| DaemonError::PeerCredentials)?;
    let pid = credentials
        .pid()
        .ok_or(DaemonError::PeerCredentials)
        .and_then(|value| u32::try_from(value).map_err(|_| DaemonError::PeerCredentials))?;

    Ok(PeerIdentity {
        pid,
        uid: credentials.uid(),
        gid: credentials.gid(),
    })
}
