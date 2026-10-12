//! Signed, immutable worker launch manifest and sealed-memfd transport.
//!
//! The manifest binds the worker image, OCap budget, cgroup identity, Landlock
//! ABI, descriptor ceiling, broker endpoint, and trusted roots. The supervisor
//! signs it with the root-provisioned Ed25519 key before sealing the memfd.

use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::CString,
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::fs::MetadataExt,
    },
    path::{Path, PathBuf},
};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{CapabilityClaims, SandboxError, SignedCapability, MAX_BROKER_FRAME_BYTES};

pub const WORKER_MANIFEST_VERSION: u32 = 1;
pub const REQUIRED_LANDLOCK_ABI: u32 = 8;
pub const WORKER_MAX_OPEN_FDS: u64 = 256;
pub const MIN_CPU_WEIGHT: u32 = 1;
pub const MAX_CPU_WEIGHT: u32 = 10_000;
const REQUIRED_MEMFD_SEALS: libc::c_int =
    libc::F_SEAL_WRITE | libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerManifest {
    pub version: u32,
    /// Absolute path of the already-running broker Unix socket.
    pub broker_socket: PathBuf,
    /// Stable root IDs mapped to daemon-controlled absolute directories.
    pub roots: BTreeMap<String, PathBuf>,
    pub capability: SignedCapability,
    /// SHA-256 of the exact trusted klyn-worker ELF image.
    pub worker_executable_sha256: String,
    /// Explicit allow-list of native execution image digests. The current
    /// worker model forbids direct exec by seccomp; this list is an attested
    /// policy inventory, not permission to bypass the broker or seccomp.
    pub allowed_execution_binary_sha256: Vec<String>,
    pub landlock_abi: u32,
    pub max_open_fds: u64,
    /// Exact cgroup-v2 leaf the supervisor attached this worker to.
    pub cgroup_path: PathBuf,
    /// Linux cgroup v2 cpu.weight (1..=10000).
    pub cpu_weight: u32,
    /// Ed25519 signature over the payload fields above; excluded from itself.
    pub signature: Vec<u8>,
}

#[derive(Serialize)]
struct WorkerManifestPayload<'a> {
    version: u32,
    broker_socket: &'a PathBuf,
    roots: &'a BTreeMap<String, PathBuf>,
    capability: &'a SignedCapability,
    worker_executable_sha256: &'a str,
    allowed_execution_binary_sha256: &'a [String],
    landlock_abi: u32,
    max_open_fds: u64,
    cgroup_path: &'a PathBuf,
    cpu_weight: u32,
}

impl WorkerManifest {
    fn payload_bytes(&self) -> Result<Vec<u8>, SandboxError> {
        Ok(serde_json::to_vec(&WorkerManifestPayload {
            version: self.version,
            broker_socket: &self.broker_socket,
            roots: &self.roots,
            capability: &self.capability,
            worker_executable_sha256: &self.worker_executable_sha256,
            allowed_execution_binary_sha256: &self.allowed_execution_binary_sha256,
            landlock_abi: self.landlock_abi,
            max_open_fds: self.max_open_fds,
            cgroup_path: &self.cgroup_path,
            cpu_weight: self.cpu_weight,
        })?)
    }

    pub fn validate_fields(&self) -> Result<(), SandboxError> {
        if self.version != WORKER_MANIFEST_VERSION {
            return Err(SandboxError::InvalidConfig(format!(
                "unsupported worker manifest version {}",
                self.version
            )));
        }
        if !self.broker_socket.is_absolute() {
            return Err(SandboxError::InvalidConfig(
                "broker socket path must be absolute".into(),
            ));
        }
        if self.roots.is_empty() {
            return Err(SandboxError::InvalidConfig(
                "worker manifest must contain at least one trusted root".into(),
            ));
        }
        for (id, path) in &self.roots {
            if id.is_empty() || id.len() > 128 || !path.is_absolute() {
                return Err(SandboxError::InvalidConfig(
                    "trusted root IDs must be bounded and paths absolute".into(),
                ));
            }
        }
        if self.landlock_abi != REQUIRED_LANDLOCK_ABI {
            return Err(SandboxError::Enforcement(format!(
                "manifest requires Landlock ABI {}, this worker requires ABI {}",
                self.landlock_abi, REQUIRED_LANDLOCK_ABI
            )));
        }
        if self.max_open_fds != WORKER_MAX_OPEN_FDS {
            return Err(SandboxError::Enforcement(format!(
                "manifest FD limit must be exactly {WORKER_MAX_OPEN_FDS}"
            )));
        }
        if !(MIN_CPU_WEIGHT..=MAX_CPU_WEIGHT).contains(&self.cpu_weight) {
            return Err(SandboxError::InvalidConfig(
                "cgroup cpu.weight must be in 1..=10000".into(),
            ));
        }
        if !self.cgroup_path.is_absolute()
            || self.cgroup_path == Path::new("/")
            || self.cgroup_path.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::CurDir | std::path::Component::ParentDir
                )
            })
        {
            return Err(SandboxError::InvalidConfig(
                "cgroup path must be a canonical-looking non-root absolute path".into(),
            ));
        }
        if !valid_sha256(&self.worker_executable_sha256) {
            return Err(SandboxError::InvalidConfig(
                "worker executable digest must be 64 lowercase hexadecimal characters".into(),
            ));
        }
        if self.allowed_execution_binary_sha256.is_empty()
            || self.allowed_execution_binary_sha256.len() > 64
        {
            return Err(SandboxError::InvalidConfig(
                "execution binary digest allow-list must contain 1..=64 entries".into(),
            ));
        }
        let mut digests = BTreeSet::new();
        for digest in &self.allowed_execution_binary_sha256 {
            if !valid_sha256(digest) || !digests.insert(digest.as_str()) {
                return Err(SandboxError::InvalidConfig(
                    "execution binary digests must be valid, unique lowercase SHA-256 values"
                        .into(),
                ));
            }
        }
        if !digests.contains(self.worker_executable_sha256.as_str()) {
            return Err(SandboxError::InvalidConfig(
                "worker executable digest is absent from the execution binary allow-list".into(),
            ));
        }
        let claims: &CapabilityClaims = &self.capability.claims;
        claims.validate()?;
        Ok(())
    }

    /// Sign the fixed-order v1 payload. The private key must be held by the
    /// trusted supervisor/key service and must never be sent to the worker.
    pub fn sign(&mut self, key: &SigningKey) -> Result<(), SandboxError> {
        self.validate_fields()?;
        self.signature = key.sign(&self.payload_bytes()?).to_bytes().to_vec();
        Ok(())
    }

    pub fn verify_signature(&self, key: &VerifyingKey) -> Result<(), SandboxError> {
        self.validate_fields()?;
        let signature = Signature::from_slice(&self.signature).map_err(|_| {
            SandboxError::Enforcement("worker manifest signature is not 64 bytes".into())
        })?;
        key.verify(&self.payload_bytes()?, &signature)
            .map_err(|_| SandboxError::Enforcement("worker manifest signature is invalid".into()))
    }

    pub fn verify_worker_executable(
        &self,
        executable: impl AsRef<Path>,
    ) -> Result<(), SandboxError> {
        let digest = sha256_file(executable)?;
        if digest != self.worker_executable_sha256
            || !self
                .allowed_execution_binary_sha256
                .iter()
                .any(|allowed| allowed == &digest)
        {
            return Err(SandboxError::Enforcement(
                "worker executable SHA-256 is not authorized by the sealed manifest".into(),
            ));
        }
        Ok(())
    }

    /// Create a memfd that is immutable before it can be inherited by a child.
    /// The signature is verified against the supplied key before sealing.
    pub fn seal_memfd(&self, key: &VerifyingKey) -> Result<File, SandboxError> {
        self.verify_signature(key)?;
        let bytes = serde_json::to_vec(self)?;
        if bytes.is_empty() || bytes.len() > MAX_BROKER_FRAME_BYTES {
            return Err(SandboxError::InvalidConfig(
                "serialized worker manifest exceeds the permitted size".into(),
            ));
        }

        let name = CString::new("klyn-worker-manifest")
            .map_err(|_| SandboxError::InvalidConfig("invalid memfd name".into()))?;
        let raw_fd = unsafe {
            libc::syscall(
                libc::SYS_memfd_create,
                name.as_ptr(),
                libc::MFD_ALLOW_SEALING | libc::MFD_CLOEXEC,
            ) as RawFd
        };
        if raw_fd < 0 {
            return Err(SandboxError::Enforcement(format!(
                "memfd_create failed: {}",
                io::Error::last_os_error()
            )));
        }
        let mut file = unsafe { File::from_raw_fd(raw_fd) };
        file.write_all(&bytes)?;
        file.flush()?;
        if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, REQUIRED_MEMFD_SEALS) } < 0 {
            return Err(SandboxError::Enforcement(format!(
                "sealing worker manifest failed: {}",
                io::Error::last_os_error()
            )));
        }
        let seals = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GET_SEALS) };
        if seals < 0 || seals & REQUIRED_MEMFD_SEALS != REQUIRED_MEMFD_SEALS {
            return Err(SandboxError::Enforcement(
                "kernel did not confirm all manifest immutability seals".into(),
            ));
        }
        file.seek(SeekFrom::Start(0))?;
        Ok(file)
    }
}

/// Read and validate a sealed manifest from an owned descriptor. Ownership of
/// fd transfers to this function, including all error paths.
pub fn read_sealed_manifest_fd(fd: RawFd) -> Result<WorkerManifest, SandboxError> {
    if fd < 0 {
        return Err(SandboxError::InvalidConfig("invalid manifest FD".into()));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let seals = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GET_SEALS) };
    if seals < 0 || seals & REQUIRED_MEMFD_SEALS != REQUIRED_MEMFD_SEALS {
        return Err(SandboxError::Enforcement(
            "manifest FD is not an immutable sealed memfd".into(),
        ));
    }
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.mode() & libc::S_IFMT as u32 != libc::S_IFREG as u32
        || metadata.len() == 0
        || metadata.len() > MAX_BROKER_FRAME_BYTES as u64
    {
        return Err(SandboxError::Enforcement(
            "manifest FD must be a bounded regular file".into(),
        ));
    }
    let expected_size = metadata.len();
    let mut bytes = Vec::with_capacity(expected_size as usize);
    Read::by_ref(&mut file)
        .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != expected_size || bytes.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::Enforcement(
            "manifest size changed or is outside the permitted range".into(),
        ));
    }
    let manifest: WorkerManifest = serde_json::from_slice(&bytes)?;
    manifest.validate_fields()?;
    Ok(manifest)
}

pub fn sha256_file(path: impl AsRef<Path>) -> Result<String, SandboxError> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let bytes = digest.finalize();
    let mut encoded = String::with_capacity(64);
    for byte in bytes {
        use std::fmt::Write as _;
        // Writing into String is infallible.
        let _ = write!(&mut encoded, "{byte:02x}");
    }
    Ok(encoded)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::fd::{AsRawFd, IntoRawFd};

    fn fixture() -> WorkerManifest {
        let budget = crate::ResourceBudget {
            memory_max_bytes: 1_048_576,
            cpu_quota_micros: 10_000,
            cpu_period_micros: 100_000,
            pids_max: 4,
            io_limits: vec![],
        };
        let digest = "a".repeat(64);
        WorkerManifest {
            version: WORKER_MANIFEST_VERSION,
            broker_socket: PathBuf::from("/run/klyn/broker.sock"),
            roots: BTreeMap::from([(
                "workspace".to_owned(),
                PathBuf::from("/var/lib/klyn/workspaces/test"),
            )]),
            capability: SignedCapability {
                claims: CapabilityClaims {
                    version: crate::OCAP_VERSION,
                    token_id: "manifest-test".into(),
                    subject_uid: 1000,
                    subject_gid: 1000,
                    expires_at_unix: u64::MAX,
                    file_grants: vec![],
                    network_grants: vec![],
                    budget,
                },
                signature: vec![1; 64],
            },
            worker_executable_sha256: digest.clone(),
            allowed_execution_binary_sha256: vec![digest],
            landlock_abi: REQUIRED_LANDLOCK_ABI,
            max_open_fds: WORKER_MAX_OPEN_FDS,
            cgroup_path: PathBuf::from("/sys/fs/cgroup/klyn/workers/test-worker"),
            cpu_weight: 100,
            signature: Vec::new(),
        }
    }

    #[test]
    fn manifest_signature_binds_cgroup_binary_and_resource_policy() {
        let key = SigningKey::from_bytes(&[0x31; 32]);
        let mut manifest = fixture();
        manifest.sign(&key).expect("sign valid manifest");
        manifest
            .verify_signature(&key.verifying_key())
            .expect("signature must verify");
        manifest.cpu_weight = 101;
        assert!(manifest.verify_signature(&key.verifying_key()).is_err());
    }

    #[test]
    fn sealed_manifest_requires_all_immutability_seals() {
        let key = SigningKey::from_bytes(&[0x42; 32]);
        let mut manifest = fixture();
        manifest.sign(&key).expect("sign valid manifest");
        let file = manifest
            .seal_memfd(&key.verifying_key())
            .expect("create sealed memfd");
        let seals = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GET_SEALS) };
        assert!(seals >= 0);
        assert_eq!(seals & REQUIRED_MEMFD_SEALS, REQUIRED_MEMFD_SEALS);

        let duplicate = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
        assert!(duplicate >= 0);
        let decoded = read_sealed_manifest_fd(duplicate).expect("read sealed manifest");
        decoded
            .verify_signature(&key.verifying_key())
            .expect("decoded manifest signature must verify");
    }

    #[test]
    fn rejects_unsealed_descriptor() {
        let file = tempfile::tempfile().expect("temporary file");
        let raw = file.into_raw_fd();
        assert!(read_sealed_manifest_fd(raw).is_err());
    }

    #[test]
    fn rejects_noncanonical_or_duplicate_execution_digests() {
        let mut manifest = fixture();
        manifest.worker_executable_sha256 = "A".repeat(64);
        assert!(manifest.validate_fields().is_err());
        manifest.worker_executable_sha256 = "a".repeat(64);
        manifest
            .allowed_execution_binary_sha256
            .push("a".repeat(64));
        assert!(manifest.validate_fields().is_err());
    }
}
