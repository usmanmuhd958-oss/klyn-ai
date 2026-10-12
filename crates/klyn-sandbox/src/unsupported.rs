//! Fail-closed API surface for targets without the Linux sandbox backend.
//!
//! The stubs intentionally do not emulate enforcement. Every operation that
//! could initialize a broker, validate platform enforcement, release a worker,
//! or execute a payload returns UnsupportedPlatform.

// Explicitly unsupported cgroup-v2 handle. No control files are touched.
#[cfg(not(target_os = "linux"))]
pub struct CgroupV2 {
    path: std::path::PathBuf,
}

#[cfg(not(target_os = "linux"))]
impl CgroupV2 {
    pub fn create(
        _delegated_root: impl AsRef<std::path::Path>,
        _id: &str,
        _budget: &crate::ResourceBudget,
    ) -> Result<Self, crate::SandboxError> {
        Err(crate::SandboxError::UnsupportedPlatform)
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn attach_pid(&self, _pid: u32) -> Result<(), crate::SandboxError> {
        Err(crate::SandboxError::UnsupportedPlatform)
    }

    pub fn kill_all(&self) -> Result<(), crate::SandboxError> {
        Err(crate::SandboxError::UnsupportedPlatform)
    }

    pub fn terminate_and_wait(
        &self,
        _timeout: std::time::Duration,
    ) -> Result<(), crate::SandboxError> {
        Err(crate::SandboxError::UnsupportedPlatform)
    }
}

pub mod broker {
    use crate::{FileAccess, SandboxError, SignedCapability};
    use ed25519_dalek::VerifyingKey;
    use std::{
        collections::BTreeMap,
        io,
        path::{Path, PathBuf},
        sync::Arc,
    };

    pub trait CapabilityVerifier: Send + Sync + 'static {
        fn verify(&self, token: &SignedCapability) -> Result<(), String>;
    }

    pub trait RevocationOracle: Send + Sync + 'static {
        fn is_revoked(&self, token_id: &str) -> Result<bool, String>;
    }

    pub struct Ed25519CapabilityVerifier {
        _key: VerifyingKey,
    }

    impl Ed25519CapabilityVerifier {
        pub fn new(key: VerifyingKey) -> Self {
            Self { _key: key }
        }
    }

    impl CapabilityVerifier for Ed25519CapabilityVerifier {
        fn verify(&self, _token: &SignedCapability) -> Result<(), String> {
            Err(SandboxError::UnsupportedPlatform.to_string())
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

    pub struct ResourceBroker {
        socket_path: PathBuf,
    }

    impl ResourceBroker {
        pub fn bind(_config: BrokerConfig) -> Result<Self, SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn socket_path(&self) -> &Path {
            &self.socket_path
        }
        pub fn serve(self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }

    pub struct BrokerClient;

    impl BrokerClient {
        pub fn connect_reserved(_path: impl AsRef<Path>) -> io::Result<Self> {
            Err(io::Error::new(io::ErrorKind::Unsupported,
                SandboxError::UnsupportedPlatform.to_string()))
        }

        #[cfg(unix)]
        pub fn open_file(
            &self,
            _capability: &SignedCapability,
            _root_id: impl Into<String>,
            _path: impl Into<String>,
            _access: FileAccess,
        ) -> Result<std::os::fd::OwnedFd, String> {
            Err(SandboxError::UnsupportedPlatform.to_string())
        }

        #[cfg(not(unix))]
        pub fn open_file(
            &self,
            _capability: &SignedCapability,
            _root_id: impl Into<String>,
            _path: impl Into<String>,
            _access: FileAccess,
        ) -> Result<(), String> {
            Err(SandboxError::UnsupportedPlatform.to_string())
        }

        #[cfg(unix)]
        pub fn connect_tcp(
            &self,
            _capability: &SignedCapability,
            _address: impl Into<String>,
        ) -> Result<std::os::fd::OwnedFd, String> {
            Err(SandboxError::UnsupportedPlatform.to_string())
        }

        #[cfg(not(unix))]
        pub fn connect_tcp(
            &self,
            _capability: &SignedCapability,
            _address: impl Into<String>,
        ) -> Result<(), String> {
            Err(SandboxError::UnsupportedPlatform.to_string())
        }
    }
}

pub mod cgroup {
    use crate::{ResourceBudget, SandboxError};
    use std::{
        path::{Path, PathBuf},
        time::Duration,
    };

    pub const MIN_CPU_WEIGHT: u32 = 1;
    pub const MAX_CPU_WEIGHT: u32 = 10_000;

    pub struct CgroupV2Boundary {
        path: PathBuf,
        budget: ResourceBudget,
        cpu_weight: u32,
    }

    impl CgroupV2Boundary {
        pub fn create(
            _delegated_root: impl AsRef<Path>,
            _worker_id: &str,
            _budget: &ResourceBudget,
            _cpu_weight: u32,
        ) -> Result<Self, SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn path(&self) -> &Path {
            &self.path
        }
        pub fn budget(&self) -> &ResourceBudget {
            &self.budget
        }
        pub fn cpu_weight(&self) -> u32 {
            self.cpu_weight
        }
        pub fn attach_and_verify(&self, _pid: u32) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_limits(&self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn kill_all(&self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn terminate_and_wait(&self, _timeout: Duration) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_current(
            _expected_path: impl AsRef<Path>,
            _budget: &ResourceBudget,
            _cpu_weight: u32,
        ) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }
}

pub mod landlock_seccomp {
    use crate::{CapabilityClaims, SandboxError};
    use std::{collections::BTreeMap, path::PathBuf};

    pub type RestrictionStatus = ();

    pub fn apply_landlock(
        _claims: &CapabilityClaims,
        _roots: &BTreeMap<String, PathBuf>,
    ) -> Result<RestrictionStatus, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }

    pub fn apply_worker_seccomp(_broker_fd: i32) -> Result<(), SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }

    pub fn enforce_worker(
        _claims: &CapabilityClaims,
        _roots: &BTreeMap<String, PathBuf>,
        _broker_fd: i32,
    ) -> Result<(), SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }
}

pub mod manifest {
    use crate::{SandboxError, SignedCapability};
    use ed25519_dalek::{SigningKey, VerifyingKey};
    use serde::{Deserialize, Serialize};
    use std::{
        collections::BTreeMap,
        fs::File,
        path::{Path, PathBuf},
    };

    pub const WORKER_MANIFEST_VERSION: u32 = 1;
    pub const REQUIRED_LANDLOCK_ABI: u32 = 8;
    pub const WORKER_MAX_OPEN_FDS: u64 = 256;
    pub const MIN_CPU_WEIGHT: u32 = 1;
    pub const MAX_CPU_WEIGHT: u32 = 10_000;

    #[derive(Clone, Debug, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    pub struct WorkerManifest {
        pub version: u32,
        pub broker_socket: PathBuf,
        pub roots: BTreeMap<String, PathBuf>,
        pub capability: SignedCapability,
        pub worker_executable_sha256: String,
        pub allowed_execution_binary_sha256: Vec<String>,
        pub landlock_abi: u32,
        pub max_open_fds: u64,
        pub cgroup_path: PathBuf,
        pub cpu_weight: u32,
        pub signature: Vec<u8>,
    }

    impl WorkerManifest {
        pub fn validate_fields(&self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn sign(&mut self, _key: &SigningKey) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_signature(&self, _key: &VerifyingKey) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_current_fd_limit(&self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_worker_executable(
            &self,
            _executable: impl AsRef<Path>,
        ) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn seal_memfd(&self, _key: &VerifyingKey) -> Result<File, SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }

    pub fn read_sealed_manifest_fd(_fd: i32) -> Result<WorkerManifest, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }

    pub fn sha256_file(_path: impl AsRef<Path>) -> Result<String, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }
}

pub mod start_gate {
    use crate::{cgroup::CgroupV2Boundary, manifest::WorkerManifest, SandboxError};
    use ed25519_dalek::VerifyingKey;
    use std::time::Duration;

    pub const START_GATE_FD: i32 = 5;
    pub const START_GATE_RELEASE: u8 = 0xA5;
    pub const WORKER_POLICY_GATE_FD: i32 = 6;
    pub const WORKER_POLICY_READY: u8 = 0xC3;
    pub const MISSION_RELEASE: u8 = 0x5A;

    pub struct UnsupportedGateEndpoint;
    pub struct StartGate;
    pub struct WorkerPolicyGate;

    impl StartGate {
        pub fn pair() -> Result<(Self, UnsupportedGateEndpoint), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn release_after_verification(
            &mut self,
            _cgroup: &CgroupV2Boundary,
            _pid: u32,
            _manifest: &WorkerManifest,
            _verifying_key: &VerifyingKey,
        ) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }

    impl WorkerPolicyGate {
        pub fn pair() -> Result<(Self, UnsupportedGateEndpoint), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn verify_policy_and_release(
            &mut self,
            _timeout: Duration,
        ) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }

    pub fn worker_wait_for_supervisor_release() -> Result<(), SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }
}

pub mod supervisor {
    use crate::{SandboxError, SignedCapability};
    use ed25519_dalek::SigningKey;
    use std::{
        path::{Path, PathBuf},
        process::ExitStatus,
    };

    pub struct WorkerLaunchConfig {
        pub init_executable: PathBuf,
        pub worker_executable: PathBuf,
        pub delegated_cgroup_root: PathBuf,
        pub worker_id: String,
        pub broker_socket: PathBuf,
        pub roots: std::collections::BTreeMap<String, PathBuf>,
        pub capability: SignedCapability,
        pub cpu_weight: u32,
    }

    pub struct SpawnedWorker {
        pid: u32,
        cgroup_path: PathBuf,
    }

    impl SpawnedWorker {
        pub fn pid(&self) -> u32 {
            self.pid
        }
        pub fn cgroup_path(&self) -> &Path {
            &self.cgroup_path
        }
        pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn wait(&mut self) -> Result<ExitStatus, SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
        pub fn terminate(&mut self) -> Result<(), SandboxError> {
            Err(SandboxError::UnsupportedPlatform)
        }
    }

    pub fn launch_worker(
        _config: WorkerLaunchConfig,
        _manifest_signing_key: &SigningKey,
    ) -> Result<SpawnedWorker, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }
}

pub mod worker_bootstrap {
    use crate::{broker::BrokerClient, manifest::WorkerManifest, SandboxError};
    use ed25519_dalek::VerifyingKey;

    pub const VERIFY_KEY_PATH: &str = "/etc/klyn/ocap-ed25519.pub";

    pub struct WorkerBootstrapContext {
        pub manifest: WorkerManifest,
        pub broker: BrokerClient,
    }

    pub fn initialize() -> Result<WorkerBootstrapContext, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }

    pub fn validate_manifest_shape(_manifest: &WorkerManifest) -> Result<(), SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }

    pub fn load_trusted_verifying_key() -> Result<VerifyingKey, SandboxError> {
        Err(SandboxError::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        cgroup::CgroupV2Boundary,
        landlock_seccomp,
        supervisor::{self, WorkerLaunchConfig},
        worker_bootstrap, CapabilityClaims, FileGrant, NetworkGrant, ResourceBudget, SandboxError,
        SignedCapability, OCAP_VERSION,
    };
    use ed25519_dalek::SigningKey;
    use std::path::PathBuf;

    fn claims() -> CapabilityClaims {
        CapabilityClaims {
            version: OCAP_VERSION,
            token_id: "unsupported-platform-test".into(),
            subject_uid: 1000,
            subject_gid: 1000,
            expires_at_unix: u64::MAX,
            file_grants: Vec::<FileGrant>::new(),
            network_grants: Vec::<NetworkGrant>::new(),
            budget: ResourceBudget {
                memory_max_bytes: 1_048_576,
                cpu_quota_micros: 10_000,
                cpu_period_micros: 100_000,
                pids_max: 4,
                io_limits: vec![],
            },
        }
    }

    #[test]
    fn enforcement_and_launch_entrypoints_fail_closed() {
        let capability = SignedCapability {
            claims: claims(),
            signature: vec![0; 64],
        };
        assert!(matches!(
            CgroupV2Boundary::create("/tmp", "test-worker", &capability.claims.budget, 100),
            Err(SandboxError::UnsupportedPlatform)
        ));
        assert!(matches!(
            landlock_seccomp::enforce_worker(
                &capability.claims,
                &std::collections::BTreeMap::new(),
                3
            ),
            Err(SandboxError::UnsupportedPlatform)
        ));
        assert!(matches!(
            worker_bootstrap::initialize(),
            Err(SandboxError::UnsupportedPlatform)
        ));
        assert!(matches!(
            supervisor::launch_worker(
                WorkerLaunchConfig {
                    init_executable: PathBuf::from("/tmp/init"),
                    worker_executable: PathBuf::from("/tmp/worker"),
                    delegated_cgroup_root: PathBuf::from("/sys/fs/cgroup"),
                    worker_id: "test-worker".into(),
                    broker_socket: PathBuf::from("/tmp/broker.sock"),
                    roots: std::collections::BTreeMap::new(),
                    capability,
                    cpu_weight: 100,
                },
                &SigningKey::from_bytes(&[0x55; 32]),
            ),
            Err(SandboxError::UnsupportedPlatform)
        ));
    }

    #[test]
    fn validation_helpers_do_not_claim_host_security_support() {
        assert!(matches!(
            crate::validate_trusted_root("/tmp"),
            Err(SandboxError::UnsupportedPlatform)
        ));
        assert!(matches!(
            crate::validate_trusted_executable("/tmp/worker"),
            Err(SandboxError::UnsupportedPlatform)
        ));
    }
}
