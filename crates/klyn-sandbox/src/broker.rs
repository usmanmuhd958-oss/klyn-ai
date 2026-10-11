//! Zero-trust resource broker over AF_UNIX with per-request OCap/KEL checks.
//!
//! The broker accepts one framed JSON request at a time per connection and
//! transfers a single descriptor with SCM_RIGHTS only after authorization. File
//! opens use openat2 relative to a pinned root FD with BENEATH, NO_SYMLINKS,
//! NO_MAGICLINKS and NO_XDEV. TCP destinations must be literal socket addresses
//! named in a signed capability; the broker never resolves hostnames.

use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, IoSlice, Read, Write},
    net::{SocketAddr, TcpStream},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::{fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt}, net::{UnixListener, UnixStream}},
    },
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use ed25519_dalek::{Signature, VerifyingKey};
use nix::sys::socket::{
    recvmsg, sendmsg, ControlMessage, ControlMessageOwned, MsgFlags,
};
use serde::{Deserialize, Serialize};

use crate::{
    path_is_within_grant, validate_relative_path, CapabilityClaims, FileAccess, FileGrant,
    NetworkGrant, SandboxError, SignedCapability, MAX_BROKER_FRAME_BYTES,
};

pub trait CapabilityVerifier: Send + Sync + 'static {
    /// Verify the signature over the canonical OCap v1 claims bytes.
    fn verify(&self, token: &SignedCapability) -> Result<(), String>;
}

pub trait RevocationOracle: Send + Sync + 'static {
    /// Return true only when the token is revoked. Errors are fail-closed.
    fn is_revoked(&self, token_id: &str) -> Result<bool, String>;
}

pub struct Ed25519CapabilityVerifier {
    key: VerifyingKey,
}

impl Ed25519CapabilityVerifier {
    pub fn new(key: VerifyingKey) -> Self {
        Self { key }
    }
}

/// Deterministic OCap v1 payload encoding: JSON objects are recursively
/// key-sorted by serde_json's default map representation; claim fields contain
/// no floating-point values. The TypeScript signer must use the same encoding.
pub fn canonical_capability_bytes(claims: &CapabilityClaims) -> Result<Vec<u8>, String> {
    let value = serde_json::to_value(claims).map_err(|e| e.to_string())?;
    serde_json::to_vec(&value).map_err(|e| e.to_string())
}

impl CapabilityVerifier for Ed25519CapabilityVerifier {
    fn verify(&self, token: &SignedCapability) -> Result<(), String> {
        let bytes = canonical_capability_bytes(&token.claims)?;
        let signature = Signature::from_slice(&token.signature).map_err(|e| e.to_string())?;
        self.key.verify_strict(&bytes, &signature).map_err(|e| e.to_string())?;
        token.claims.validate().map_err(|e| e.to_string())
    }
}

#[derive(Clone)]
pub struct BrokerConfig {
    pub socket_path: PathBuf,
    pub roots: BTreeMap<String, PathBuf>,
    pub verifier: Arc<dyn CapabilityVerifier>,
    pub revocations: Arc<dyn RevocationOracle>,
    pub max_workers: usize,
    pub queue_capacity: usize,
}

struct RootHandle {
    _path: PathBuf,
    file: File,
}

struct BrokerInner {
    roots: BTreeMap<String, RootHandle>,
    verifier: Arc<dyn CapabilityVerifier>,
    revocations: Arc<dyn RevocationOracle>,
}

pub struct ResourceBroker {
    listener: UnixListener,
    socket_path: PathBuf,
    inner: Arc<BrokerInner>,
    max_workers: usize,
    queue_capacity: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerRequest {
    capability: SignedCapability,
    operation: BrokerOperation,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum BrokerOperation {
    OpenFile {
        root_id: String,
        path: String,
        access: FileAccess,
    },
    ConnectTcp {
        address: String,
    },
    /// Process execution is intentionally unavailable through the broker.
    Exec {
        program: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerResponse {
    ok: bool,
    error: Option<String>,
}

impl BrokerResponse {
    fn success() -> Self {
        Self { ok: true, error: None }
    }

    fn denied(message: impl Into<String>) -> Self {
        Self { ok: false, error: Some(message.into()) }
    }
}

impl ResourceBroker {
    pub fn bind(config: BrokerConfig) -> Result<Self, SandboxError> {
        if config.max_workers == 0 || config.queue_capacity == 0 {
            return Err(SandboxError::InvalidConfig(
                "broker worker count and queue capacity must be non-zero".into(),
            ));
        }
        let socket_path = config.socket_path;
        let parent = socket_path.parent().ok_or_else(|| {
            SandboxError::InvalidConfig("broker socket must have a parent directory".into())
        })?;
        let parent = fs::canonicalize(parent)?;
        let parent_meta = fs::metadata(&parent)?;
        let euid = unsafe { libc::geteuid() };
        if parent_meta.mode() & 0o022 != 0 || (parent_meta.uid() != 0 && parent_meta.uid() != euid) {
            return Err(SandboxError::InvalidConfig(format!(
                "broker socket parent is not trusted: {}",
                parent.display()
            )));
        }
        let file_name = socket_path.file_name().ok_or_else(|| {
            SandboxError::InvalidConfig("broker socket path has no filename".into())
        })?;
        let socket_path = parent.join(file_name);

        if let Ok(metadata) = fs::symlink_metadata(&socket_path) {
            if !metadata.file_type().is_socket() || (metadata.uid() != euid && euid != 0) {
                return Err(SandboxError::InvalidConfig(
                    "refusing to remove a non-socket or foreign-owned broker path".into(),
                ));
            }
            fs::remove_file(&socket_path)?;
        }

        let listener = UnixListener::bind(&socket_path)?;
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o666))?;

        let mut roots = BTreeMap::new();
        for (id, path) in config.roots {
            if id.is_empty() || id.len() > 128 || roots.contains_key(&id) {
                return Err(SandboxError::InvalidConfig("invalid or duplicate root id".into()));
            }
            let canonical = fs::canonicalize(path)?;
            if !fs::metadata(&canonical)?.is_dir() {
                return Err(SandboxError::InvalidConfig(format!(
                    "configured root is not a directory: {}",
                    canonical.display()
                )));
            }
            let file = OpenOptions::new().read(true).custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY).open(&canonical)?;
            roots.insert(id, RootHandle { _path: canonical, file });
        }
        Ok(Self {
            listener,
            socket_path,
            inner: Arc::new(BrokerInner {
                roots,
                verifier: config.verifier,
                revocations: config.revocations,
            }),
            max_workers: config.max_workers,
            queue_capacity: config.queue_capacity,
        })
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Bounded worker pool: overload drops new connections instead of growing
    /// memory/thread usage without bound.
    pub fn serve(self) -> Result<(), SandboxError> {
        let (tx, rx): (Sender<UnixStream>, Receiver<UnixStream>) = bounded(self.queue_capacity);
        let mut workers = Vec::with_capacity(self.max_workers);
        for _ in 0..self.max_workers {
            let rx = rx.clone();
            let inner = Arc::clone(&self.inner);
            workers.push(std::thread::spawn(move || {
                while let Ok(stream) = rx.recv() {
                    let _ = handle_connection(stream, &inner);
                }
            }));
        }
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => match tx.try_send(stream) {
                    Ok(()) => {}
                    Err(TrySendError::Full(stream)) | Err(TrySendError::Disconnected(stream)) => {
                        drop(stream);
                    }
                },
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(SandboxError::Io(e)),
            }
        }
    }
}

impl Drop for ResourceBroker {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket_path);
    }
}

#[derive(Clone, Copy)]
struct PeerCredentials {
    uid: u32,
    gid: u32,
}

fn peer_credentials(stream: &UnixStream) -> io::Result<PeerCredentials> {
    let mut cred = std::mem::MaybeUninit::<libc::ucred>::zeroed();
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            cred.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    if len as usize != std::mem::size_of::<libc::ucred>() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "unexpected SO_PEERCRED size"));
    }
    let cred = unsafe { cred.assume_init() };
    Ok(PeerCredentials { uid: cred.uid, gid: cred.gid })
}

fn handle_connection(mut stream: UnixStream, inner: &BrokerInner) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let peer = peer_credentials(&stream)?;
    loop {
        let payload = match read_frame(&mut stream) {
            Ok(Some(payload)) => payload,
            Ok(None) => return Ok(()),
            Err(e) => {
                let response = BrokerResponse::denied(format!("invalid frame: {e}"));
                let _ = write_frame(&mut stream, &response);
                return Err(e);
            }
        };
        let request: BrokerRequest = match serde_json::from_slice(&payload) {
            Ok(request) => request,
            Err(e) => {
                write_frame(&mut stream, &BrokerResponse::denied(format!("invalid request: {e}")))?;
                continue;
            }
        };

        // Signature, expiry, caller identity, and current revocation state are
        // checked for every operation, before any resource is opened or connected.
        let claims = match authorize(&request.capability, peer, inner) {
            Ok(claims) => claims,
            Err(e) => {
                write_frame(&mut stream, &BrokerResponse::denied(e))?;
                continue;
            }
        };

        match execute_request(&claims, request.operation, inner) {
            Ok(fd) => {
                write_frame(&mut stream, &BrokerResponse::success())?;
                if let Some(fd) = fd {
                    send_fd(stream.as_raw_fd(), fd.as_raw_fd())?;
                }
            }
            Err(e) => write_frame(&mut stream, &BrokerResponse::denied(e))?,
        }
    }
}

fn authorize(
    token: &SignedCapability,
    peer: PeerCredentials,
    inner: &BrokerInner,
) -> Result<CapabilityClaims, String> {
    inner.verifier.verify(token).map_err(|_| "capability signature invalid".to_string())?;
    token.claims.validate().map_err(|_| "capability claims invalid".to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before UNIX epoch".to_string())?
        .as_secs();
    if now >= token.claims.expires_at_unix {
        return Err("capability expired".into());
    }
    if token.claims.subject_uid != peer.uid || token.claims.subject_gid != peer.gid {
        return Err("peer credentials do not match capability subject".into());
    }
    if inner.revocations.is_revoked(&token.claims.token_id)
        .map_err(|_| "KEL revocation oracle unavailable; request denied".to_string())?
    {
        return Err("capability revoked by KEL".into());
    }
    Ok(token.claims.clone())
}

fn execute_request(
    claims: &CapabilityClaims,
    operation: BrokerOperation,
    inner: &BrokerInner,
) -> Result<Option<OwnedFd>, String> {
    match operation {
        BrokerOperation::OpenFile { root_id, path, access } => {
            validate_relative_path(&path, false).map_err(|_| "invalid relative path".to_string())?;
            let grant: &FileGrant = claims.file_grants.iter().find(|grant| {
                grant.root_id == root_id
                    && grant.access.permits(access)
                    && path_is_within_grant(&path, &grant.prefix)
            }).ok_or_else(|| "file operation is outside capability scope".to_string())?;
            let root = inner.roots.get(&root_id).ok_or_else(|| "unknown filesystem root".to_string())?;
            let fd = open_beneath(root.file.as_raw_fd(), &path, access)
                .map_err(|_| "kernel rejected secure file open".to_string())?;
                    let _ = grant;
            Ok(Some(fd))
        }
        BrokerOperation::ConnectTcp { address } => {
            let requested: SocketAddr = address.parse().map_err(|_| "address must be a literal socket address".to_string())?;
            let allowed = claims.network_grants.iter().any(|grant: &NetworkGrant| {
                grant.address.parse::<SocketAddr>().map(|addr| addr == requested).unwrap_or(false)
            });
            if !allowed {
                return Err("network destination is outside capability scope".into());
            }
            let stream = TcpStream::connect_timeout(&requested, Duration::from_secs(3))
                .map_err(|_| "authorized TCP connection failed".to_string())?;
            stream.set_nodelay(true).map_err(|_| "failed to configure authorized TCP socket".to_string())?;
            Ok(Some(OwnedFd::from(stream)))
        }
        BrokerOperation::Exec { program: _ } => Err("process execution is not a broker operation".into()),
    }
}

#[repr(C)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

fn open_beneath(root_fd: RawFd, path: &str, access: FileAccess) -> io::Result<OwnedFd> {
    const RESOLVE_NO_XDEV: u64 = 0x01;
    const RESOLVE_NO_MAGICLINKS: u64 = 0x02;
    const RESOLVE_NO_SYMLINKS: u64 = 0x04;
    const RESOLVE_BENEATH: u64 = 0x08;

    let path = std::ffi::CString::new(path)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in path"))?;
    let flags = match access {
        FileAccess::Read => libc::O_RDONLY,
        FileAccess::Write => libc::O_WRONLY,
        FileAccess::ReadWrite => libc::O_RDWR,
    } | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK;
    let how = OpenHow {
        flags: flags as u64,
        mode: 0,
        resolve: RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV,
    };
    let fd = unsafe {
        libc::syscall(
            libc::SYS_openat2,
            root_fd,
            path.as_ptr(),
            &how as *const OpenHow,
            std::mem::size_of::<OpenHow>(),
        ) as RawFd
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // Do not broker device nodes, FIFOs, sockets, or other special files even
    // when they happen to live below an authorized directory.
    let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
        let error = io::Error::last_os_error();
        unsafe { libc::close(fd); }
        return Err(error);
    }
    let file_type = unsafe { stat.assume_init() }.st_mode & libc::S_IFMT;
    if file_type != libc::S_IFREG && file_type != libc::S_IFDIR {
        unsafe { libc::close(fd); }
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "only regular files and directories may be brokered",
        ));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn read_frame(stream: &mut UnixStream) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    let mut read = 0;
    while read < header.len() {
        match stream.read(&mut header[read..]) {
            Ok(0) if read == 0 => return Ok(None),
            Ok(0) => return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "truncated frame header")),
            Ok(n) => read += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_BROKER_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame length out of bounds"));
    }
    let mut payload = vec![0; length];
    stream.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame<T: Serialize>(stream: &mut UnixStream, value: &T) -> io::Result<()> {
    let payload = serde_json::to_vec(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    if payload.is_empty() || payload.len() > MAX_BROKER_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "response frame length out of bounds"));
    }
    stream.write_all(&(payload.len() as u32).to_be_bytes())?;
    stream.write_all(&payload)?;
    stream.flush()
}

fn send_fd(socket: RawFd, fd: RawFd) -> io::Result<()> {
    let byte = [b'F'];
    let iov = [IoSlice::new(&byte)];
    let fds = [fd];
    let cmsg = ControlMessage::ScmRights(&fds);
    let sent = sendmsg::<()>(socket, &iov, &[cmsg], MsgFlags::MSG_NOSIGNAL, None)
        .map_err(io::Error::from)?;
    if sent != 1 {
        return Err(io::Error::new(io::ErrorKind::WriteZero, "SCM_RIGHTS marker was not sent"));
    }
    Ok(())
}

/// A serialized client for the inherited broker channel. The descriptor is
/// normalized to FD 3 before seccomp is installed; calls are serialized so the
/// JSON reply and its ancillary descriptor cannot be mixed between requests.
pub struct BrokerClient {
    stream: Mutex<UnixStream>,
}

impl BrokerClient {
    /// Adopt the broker socket inherited from the trusted launcher as FD 3.
    /// Verify the kernel-reported peer identity before taking ownership.
    pub fn from_inherited_reserved(expected_peer_uid: u32) -> io::Result<Self> {
        let raw = 3;
        let mut cred = std::mem::MaybeUninit::<libc::ucred>::zeroed();
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let rc = unsafe {
            libc::getsockopt(
                raw,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                cred.as_mut_ptr().cast(),
                &mut len,
            )
        };
        if rc != 0 {
            return Err(io::Error::last_os_error());
        }
        if len as usize != std::mem::size_of::<libc::ucred>() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid broker peer credentials"));
        }
        let cred = unsafe { cred.assume_init() };
        if cred.uid != expected_peer_uid {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "broker peer UID mismatch"));
        }
        let mut socket_type: libc::c_int = 0;
        let mut type_len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
        let rc = unsafe {
            libc::getsockopt(
                raw,
                libc::SOL_SOCKET,
                libc::SO_TYPE,
                (&mut socket_type as *mut libc::c_int).cast(),
                &mut type_len,
            )
        };
        if rc != 0 {
            return Err(io::Error::last_os_error());
        }
        if socket_type != libc::SOCK_STREAM {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "broker FD is not a stream socket"));
        }
        let stream = unsafe { UnixStream::from_raw_fd(raw) };
        Ok(Self { stream: Mutex::new(stream) })
    }

    pub fn connect_reserved(path: impl AsRef<Path>) -> io::Result<Self> {
        Self::normalize_reserved(UnixStream::connect(path)?)
    }

    /// Connect and verify SO_PEERCRED before moving the socket to descriptor 3.
    pub fn connect_verified_reserved(path: impl AsRef<Path>, expected_peer_uid: u32) -> io::Result<Self> {
        let stream = UnixStream::connect(path)?;
        verify_peer_uid(stream.as_raw_fd(), expected_peer_uid)?;
        Self::normalize_reserved(stream)
    }

    fn normalize_reserved(stream: UnixStream) -> io::Result<Self> {
        let raw = stream.as_raw_fd();
        if raw != 3 {
            let rc = unsafe { libc::dup3(raw, 3, libc::O_CLOEXEC) };
            if rc < 0 {
                return Err(io::Error::last_os_error());
            }
            drop(stream);
            let stream = unsafe { UnixStream::from_raw_fd(3) };
            return Ok(Self { stream: Mutex::new(stream) });
        }
        Ok(Self { stream: Mutex::new(stream) })
    }

    pub fn open_file(
        &self,
        capability: &SignedCapability,
        root_id: impl Into<String>,
        path: impl Into<String>,
        access: FileAccess,
    ) -> Result<OwnedFd, String> {
        self.request_fd(capability, BrokerOperation::OpenFile {
            root_id: root_id.into(),
            path: path.into(),
            access,
        })
    }

    pub fn connect_tcp(
        &self,
        capability: &SignedCapability,
        address: impl Into<String>,
    ) -> Result<OwnedFd, String> {
        self.request_fd(capability, BrokerOperation::ConnectTcp { address: address.into() })
    }

    fn request_fd(
        &self,
        capability: &SignedCapability,
        operation: BrokerOperation,
    ) -> Result<OwnedFd, String> {
        let mut stream = self.stream.lock().map_err(|_| "broker client mutex poisoned".to_string())?;
        let request = BrokerRequest { capability: capability.clone(), operation };
        write_frame(&mut stream, &request).map_err(|e| e.to_string())?;
        let bytes = read_frame(&mut stream)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "broker closed the channel".to_string())?;
        let response: BrokerResponse = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if !response.ok {
            return Err(response.error.unwrap_or_else(|| "broker denied request".into()));
        }
        receive_fd(stream.as_raw_fd()).map_err(|e| e.to_string())
    }
}

fn verify_peer_uid(fd: RawFd, expected_uid: u32) -> io::Result<()> {
    let mut cred = std::mem::MaybeUninit::<libc::ucred>::zeroed();
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            cred.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    if len as usize != std::mem::size_of::<libc::ucred>() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid broker peer credentials"));
    }
    if unsafe { cred.assume_init() }.uid != expected_uid {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "broker peer UID mismatch"));
    }
    Ok(())
}

fn receive_fd(socket: RawFd) -> io::Result<OwnedFd> {
    let mut marker = [0u8; 1];
    let mut iov = [io::IoSliceMut::new(&mut marker)];
    let mut cmsgspace = nix::cmsg_space!([RawFd; 8]);
    let msg = recvmsg::<()>(
        socket,
        &mut iov,
        Some(&mut cmsgspace),
        MsgFlags::MSG_CMSG_CLOEXEC,
    ).map_err(io::Error::from)?;
    let mut received = Vec::new();
    let bytes = msg.bytes;
    let flags = msg.flags;
    for cmsg in msg.cmsgs().map_err(io::Error::from)? {
        if let ControlMessageOwned::ScmRights(fds) = cmsg {
            for raw in fds {
                // Take ownership immediately so every unexpected descriptor is
                // closed when this vector drops on any validation error.
                received.push(unsafe { OwnedFd::from_raw_fd(raw) });
            }
        }
    }
    drop(msg);
    drop(iov);
    if flags.contains(MsgFlags::MSG_CTRUNC) || bytes != 1 || marker[0] != b'F' {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid or truncated SCM_RIGHTS frame"));
    }
    if received.len() != 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "broker must transfer exactly one descriptor"));
    }
    Ok(received.pop().expect("length checked"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::os::fd::AsRawFd;

    struct NeverRevoked;
    impl RevocationOracle for NeverRevoked {
        fn is_revoked(&self, _: &str) -> Result<bool, String> { Ok(false) }
    }

    fn test_claims(uid: u32, gid: u32) -> CapabilityClaims {
        crate::CapabilityClaims {
            version: crate::OCAP_VERSION,
            token_id: "broker-test-token".into(),
            subject_uid: if uid == 0 { 1000 } else { uid },
            subject_gid: gid,
            expires_at_unix: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() + 60,
            file_grants: vec![FileGrant {
                root_id: "workspace".into(),
                prefix: "allowed".into(),
                access: FileAccess::Read,
            }],
            network_grants: vec![],
            budget: crate::ResourceBudget {
                memory_max_bytes: 1024 * 1024,
                cpu_quota_micros: 100_000,
                cpu_period_micros: 100_000,
                pids_max: 4,
                io_limits: vec![],
            },
        }
    }

    #[test]
    fn ed25519_capability_signature_verifies_strictly() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let claims = test_claims(unsafe { libc::geteuid() } as u32, unsafe { libc::getegid() } as u32);
        let signature = key.sign(&canonical_capability_bytes(&claims).unwrap()).to_bytes().to_vec();
        let token = SignedCapability { claims, signature };
        Ed25519CapabilityVerifier::new(key.verifying_key()).verify(&token).unwrap();

        let mut forged = token.clone();
        forged.claims.token_id = "forged".into();
        assert!(Ed25519CapabilityVerifier::new(key.verifying_key()).verify(&forged).is_err());
    }

    #[test]
    fn openat2_rejects_traversal_and_symlink_resolution() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("inside")).unwrap();
        std::fs::write(temp.path().join("inside/data.txt"), b"safe").unwrap();
        std::os::unix::fs::symlink("/etc/passwd", temp.path().join("inside/escape")).unwrap();
        let root = File::open(temp.path()).unwrap();
        assert!(open_beneath(root.as_raw_fd(), "../etc/passwd", FileAccess::Read).is_err());
        assert!(open_beneath(root.as_raw_fd(), "inside/escape", FileAccess::Read).is_err());
        let fd = open_beneath(root.as_raw_fd(), "inside/data.txt", FileAccess::Read).unwrap();
        assert!(fd.as_raw_fd() >= 0);
    }

    #[test]
    fn revocation_oracle_errors_are_not_authorization() {
        struct Failing;
        impl RevocationOracle for Failing {
            fn is_revoked(&self, _: &str) -> Result<bool, String> { Err("KEL down".into()) }
        }
        let key = SigningKey::from_bytes(&[9u8; 32]);
        let claims = test_claims(unsafe { libc::geteuid() } as u32, unsafe { libc::getegid() } as u32);
        let signed = SignedCapability {
            signature: key.sign(&canonical_capability_bytes(&claims).unwrap()).to_bytes().to_vec(),
            claims,
        };
        let inner = BrokerInner {
            roots: BTreeMap::new(),
            verifier: Arc::new(Ed25519CapabilityVerifier::new(key.verifying_key())),
            revocations: Arc::new(Failing),
        };
        let peer = PeerCredentials { uid: signed.claims.subject_uid, gid: signed.claims.subject_gid };
        assert!(authorize(&signed, peer, &inner).is_err());
    }

    #[test]
    fn revocation_prevents_any_grant() {
        struct Revoked;
        impl RevocationOracle for Revoked {
            fn is_revoked(&self, _: &str) -> Result<bool, String> { Ok(true) }
        }
        let key = SigningKey::from_bytes(&[11u8; 32]);
        let claims = test_claims(unsafe { libc::geteuid() } as u32, unsafe { libc::getegid() } as u32);
        let signed = SignedCapability {
            signature: key.sign(&canonical_capability_bytes(&claims).unwrap()).to_bytes().to_vec(),
            claims,
        };
        let inner = BrokerInner {
            roots: BTreeMap::new(),
            verifier: Arc::new(Ed25519CapabilityVerifier::new(key.verifying_key())),
            revocations: Arc::new(Revoked),
        };
        let peer = PeerCredentials { uid: signed.claims.subject_uid, gid: signed.claims.subject_gid };
        assert!(authorize(&signed, peer, &inner).is_err());
    }

    #[test]
    fn worker_access_grant_is_subtree_and_access_specific() {
        assert!(path_is_within_grant("allowed/file.txt", "allowed"));
        assert!(!path_is_within_grant("allowed2/file.txt", "allowed"));
        assert!(!FileAccess::Read.permits(FileAccess::Write));
    }
}
