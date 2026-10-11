//! Unix-domain-socket resource broker.
//!
//! A caller supplies a signed capability and a canonical invocation request. The broker
//! verifies issuer/subject/mission/audience/time, policy, durable revocation state and
//! quota; signs a runtime attestation; requires KEL acceptance; and only then resolves
//! or mutates the resource. FDs are sent with SCM_RIGHTS. Unknown/unsupported operations
//! are denied rather than delegated to ambient process APIs.

use crate::{
    digest_jcs, jcs_bytes, path_is_within, CapabilityBudget, CapabilityEvidenceEvent,
    CapabilityInvocationRequest, CapabilityKeyResolver, CapabilityResourceRequest, CapabilityScope, EvidenceReceipt,
    PreExecutionAttestationPayloadV1, PreExecutionAttestationV1, SandboxError,
    TokenExpectation, Result,
    BROKER_PROTOCOL_SCHEMA, BROKER_RESPONSE_SCHEMA, CAPABILITY_ATTESTATION_SCHEMA,
    CAPABILITY_EVIDENCE_SCHEMA, MAX_BROKER_FRAME_BYTES, MAX_FD_PAYLOAD_BYTES,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::CString,
    fs::{self, File},
    io::{self, Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    os::{
        fd::{AsFd, AsRawFd, BorrowedFd, FromRawFd, IntoRawFd, OwnedFd, RawFd},
        unix::{fs::{FileTypeExt, MetadataExt, PermissionsExt}, net::{UnixListener, UnixStream}},
    },
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering}, Arc, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};

use crate::landlock_seccomp::{open_beneath, open_scoped_directory};

const MEMFD_CLOEXEC: u32 = 0x0001;
const MFD_ALLOW_SEALING: u32 = 0x0002;
const F_ADD_SEALS: i32 = 1033;
const F_SEAL_SEAL: i32 = 0x0001;
const F_SEAL_SHRINK: i32 = 0x0002;
const F_SEAL_GROW: i32 = 0x0004;
const F_SEAL_WRITE: i32 = 0x0008;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerRequestEnvelope {
    pub schema: String,
    pub invocation: CapabilityInvocationRequest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerResponse {
    pub schema: String,
    pub invocation_id: String,
    pub allowed: bool,
    pub reason_code: String,
    pub token_digest: Option<String>,
    pub request_digest: Option<String>,
    pub fd_count: u8,
    pub attestation: Option<PreExecutionAttestationV1>,
    pub authorization_evidence: Option<EvidenceReceipt>,
    pub error: Option<String>,
}

impl BrokerResponse {
    fn denied(invocation_id: String, code: &str, error: impl ToString) -> Self {
        Self {
            schema: BROKER_RESPONSE_SCHEMA.into(),
            invocation_id,
            allowed: false,
            reason_code: code.into(),
            token_digest: None,
            request_digest: None,
            fd_count: 0,
            attestation: None,
            authorization_evidence: None,
            error: Some(error.to_string()),
        }
    }
}

#[derive(Clone, Debug)]
pub struct QuotaReservation {
    pub reservation_id: String,
    pub admitted_invocation_number: u64,
}

pub trait RevocationChecker: Send + Sync {
    /// Implementations MUST check this token and all ancestors, use durable consistent
    /// state, and fail closed on KEL/revocation-store errors.
    fn is_revoked(&self, token_id: &str, token_digest: &str, parent_digest: Option<&str>, now_epoch_ms: u64) -> Result<bool>;
}

pub trait InvocationQuotaStore: Send + Sync {
    /// Atomic across workers. Replaying an invocation ID with another request digest must fail.
    fn reserve(
        &self,
        token_id: &str,
        token_digest: &str,
        invocation_id: &str,
        request_digest: &str,
        max_invocations: u64,
        max_concurrent: u64,
        now_epoch_ms: u64,
    ) -> Result<QuotaReservation>;

    fn finish(&self, reservation_id: &str, outcome: &str, now_epoch_ms: u64) -> Result<()>;
}

pub trait CapabilityPolicyGate: Send + Sync {
    fn assert_current(&self, token: &crate::CapabilityToken, request: &CapabilityInvocationRequest, scope: &CapabilityScope) -> Result<()>;
}

pub trait RuntimeAttestor: Send + Sync {
    fn key_id(&self) -> &str;
    fn principal_id(&self) -> &str;
    fn sign_payload(&self, canonical_payload: &[u8]) -> Result<crate::CapabilitySignatureV1>;
}

pub trait CapabilityEvidenceAppender: Send + Sync {
    /// Must return only after the corresponding KEL v1 DSSE statement is durably accepted
    /// and its configured verification policy passes. A console logger is not conforming.
    fn append(&self, event: &CapabilityEvidenceEvent) -> Result<EvidenceReceipt>;
}

pub trait PeerPrincipalResolver: Send + Sync {
    fn principal_for_uid(&self, uid: u32) -> Option<String>;
}

pub trait NetworkAddressPolicy: Send + Sync {
    /// Deny by default. Deployment policy must explicitly allow resolved destinations,
    /// including any permitted loopback/private-network exceptions.
    fn allow_destination(&self, hostname: &str, address: SocketAddr) -> bool;
}

pub trait NativeOperationProvider: Send + Sync {
    /// Called only after token/policy/revocation/quota verification and KEL authorization.
    /// Implementations must launch their own child inside namespaces, Landlock, seccomp,
    /// and a per-invocation cgroup; raw Command::new in the authority process is forbidden.
    fn prepare(&self, request: &CapabilityInvocationRequest, scope: &CapabilityScope, effective_budget: &CapabilityBudget) -> Result<PreparedResource>;
}

pub struct RegisteredDirectory {
    pub resource_id: String,
    pub fd: OwnedFd,
}

#[derive(Default)]
pub struct ResourceRegistry {
    directories: Mutex<HashMap<String, RegisteredDirectory>>,
}

impl ResourceRegistry {
    pub fn register_directory(&self, handle_id: String, resource_id: String, fd: OwnedFd) -> Result<()> {
        crate::validate_directory_fd(fd.as_fd())?;
        if handle_id.is_empty() || resource_id.is_empty() {
            return Err(SandboxError::Denied("registered resource handle and resource ID are required".into()));
        }
        let mut entries = self.directories.lock().map_err(|_| SandboxError::Protocol("resource registry poisoned".into()))?;
        if entries.contains_key(&handle_id) {
            return Err(SandboxError::Denied("resource handle IDs are immutable and cannot be reused".into()));
        }
        entries.insert(handle_id, RegisteredDirectory { resource_id, fd });
        Ok(())
    }

    fn with_directory<T>(&self, handle: &str, resource_id: &str, f: impl FnOnce(BorrowedFd<'_>) -> Result<T>) -> Result<T> {
        let entries = self.directories.lock().map_err(|_| SandboxError::Protocol("resource registry poisoned".into()))?;
        let entry = entries.get(handle).ok_or_else(|| SandboxError::Denied("filesystem handle is not registered".into()))?;
        if entry.resource_id != resource_id {
            return Err(SandboxError::Denied("filesystem handle/resource identity mismatch".into()));
        }
        f(entry.fd.as_fd())
    }
}

pub struct BrokerDependencies {
    pub audience: String,
    pub runtime_instance_id: String,
    pub maximum_clock_skew_ms: u64,
    pub keys: Arc<dyn CapabilityKeyResolver>,
    pub revocations: Arc<dyn RevocationChecker>,
    pub quota: Arc<dyn InvocationQuotaStore>,
    pub policy: Arc<dyn CapabilityPolicyGate>,
    pub collector: Arc<dyn RuntimeAttestor>,
    pub evidence: Arc<dyn CapabilityEvidenceAppender>,
    pub peer_principals: Arc<dyn PeerPrincipalResolver>,
    pub network_policy: Arc<dyn NetworkAddressPolicy>,
    pub resources: Arc<ResourceRegistry>,
    /// Process, memory and IPC providers are explicit trusted launchers. If absent, those
    /// operations are rejected rather than performed with ambient daemon authority.
    pub native_provider: Option<Arc<dyn NativeOperationProvider>>,
    pub now_epoch_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
}

pub struct CapabilityBroker {
    deps: BrokerDependencies,
}

pub struct PreparedResource {
    pub fd: Option<OwnedFd>,
    /// Background I/O proxy for bounded file writes, network byte relay or isolated provider.
    pub completion: Option<JoinHandle<Result<()>>>,
}

struct InvocationState {
    request: CapabilityInvocationRequest,
    scope: CapabilityScope,
    token_digest: String,
    request_digest: String,
    quota_guard: QuotaReservationGuard,
    effective_budget: CapabilityBudget,
    attestation: PreExecutionAttestationV1,
    authorization_evidence: EvidenceReceipt,
}

pub struct BrokerGrant {
    pub response: BrokerResponse,
    pub fd: Option<OwnedFd>,
    pub completion: Option<JoinHandle<Result<()>>>,
    state: InvocationState,
}

struct QuotaReservationGuard {
    store: Arc<dyn InvocationQuotaStore>,
    reservation: QuotaReservation,
    now_epoch_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
    finalized: AtomicBool,
}

impl QuotaReservationGuard {
    fn new(
        store: Arc<dyn InvocationQuotaStore>,
        reservation: QuotaReservation,
        now_epoch_ms: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self { store, reservation, now_epoch_ms, finalized: AtomicBool::new(false) }
    }

    fn reservation(&self) -> &QuotaReservation { &self.reservation }

    fn finish(&self, outcome: &str, now_epoch_ms: u64) -> Result<()> {
        if self.finalized.load(Ordering::Acquire) { return Ok(()); }
        self.store.finish(&self.reservation.reservation_id, outcome, now_epoch_ms)?;
        self.finalized.store(true, Ordering::Release);
        Ok(())
    }
}

impl Drop for QuotaReservationGuard {
    fn drop(&mut self) {
        if !self.finalized.load(Ordering::Acquire) {
            let _ = self.store.finish(&self.reservation.reservation_id, "failed", (self.now_epoch_ms)());
            self.finalized.store(true, Ordering::Release);
        }
    }
}

impl CapabilityBroker {
    pub fn new(deps: BrokerDependencies) -> Self { Self { deps } }

    /// Bounded multiclient service loop. Exhausted admission capacity rejects new
    /// connections without parsing or executing their requests. Shutdown is cooperative;
    /// per-connection I/O deadlines bound drain time.
    pub fn serve(
        self: Arc<Self>,
        listener: PrivateBrokerListener,
        shutdown: Arc<AtomicBool>,
        max_concurrent_connections: usize,
    ) -> Result<()> {
        if max_concurrent_connections == 0 || max_concurrent_connections > 4096 {
            return Err(SandboxError::Protocol("broker connection limit must be 1..=4096".into()));
        }
        listener.listener.set_nonblocking(true)?;
        let active = Arc::new(AtomicUsize::new(0));
        let mut workers: Vec<JoinHandle<()>> = Vec::new();
        while !shutdown.load(Ordering::Acquire) {
            let mut index = 0;
            while index < workers.len() {
                if workers[index].is_finished() {
                    let handle = workers.swap_remove(index);
                    if handle.join().is_err() {
                        // A client-worker panic must not crash or authorize another request.
                    }
                } else {
                    index += 1;
                }
            }
            match listener.listener.accept() {
                Ok((mut stream, _peer_addr)) => {
                    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
                    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
                    let active_now = active.fetch_add(1, Ordering::AcqRel);
                    if active_now >= max_concurrent_connections {
                        active.fetch_sub(1, Ordering::AcqRel);
                        let response = BrokerResponse::denied("busy".into(), "broker_busy", "broker admission capacity exhausted");
                        let _ = write_frame(&mut stream, &response);
                        continue;
                    }
                    let broker = self.clone();
                    let active_worker = active.clone();
                    match thread::Builder::new().name("klyn-resource-broker-client".into()).spawn(move || {
                        let _ = broker.serve_one(&mut stream);
                        active_worker.fetch_sub(1, Ordering::AcqRel);
                    }) {
                        Ok(handle) => workers.push(handle),
                        Err(error) => {
                            active.fetch_sub(1, Ordering::AcqRel);
                            return Err(SandboxError::Io(error));
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.into()),
            }
        }
        drop(listener);
        for worker in workers {
            if worker.join().is_err() {
                return Err(SandboxError::Protocol("broker worker panicked during shutdown".into()));
            }
        }
        Ok(())
    }

    pub fn serve_one(&self, stream: &mut UnixStream) -> Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        stream.set_write_timeout(Some(Duration::from_secs(3)))?;
        let uid = peer_uid(stream.as_raw_fd())?;
        let invocation_id_hint = "unknown".to_owned();
        let principal = self.deps.peer_principals.principal_for_uid(uid)
            .ok_or_else(|| SandboxError::Denied("Unix peer UID has no configured principal".into()));
        let body = read_frame(stream);
        let parsed = body.and_then(|bytes| serde_json::from_slice::<BrokerRequestEnvelope>(&bytes)
            .map_err(|e| SandboxError::Protocol(e.to_string())));
        let envelope = match parsed {
            Ok(envelope) if envelope.schema == BROKER_PROTOCOL_SCHEMA => envelope,
            Ok(_) => {
                write_frame(stream, &BrokerResponse::denied(invocation_id_hint, "protocol_schema_invalid", "unsupported broker request schema"))?;
                return Ok(());
            }
            Err(error) => {
                let response = BrokerResponse::denied(invocation_id_hint, "malformed_request", error);
                write_frame(stream, &response)?;
                return Ok(());
            }
        };
        let request = envelope.invocation;
        let invocation_id = request.invocation_id.clone();
        let principal = match principal {
            Ok(value) => value,
            Err(error) => {
                write_frame(stream, &BrokerResponse::denied(invocation_id, "peer_identity_denied", error))?;
                return Ok(());
            }
        };
        if principal != request.principal_id {
            write_frame(stream, &BrokerResponse::denied(invocation_id, "peer_principal_mismatch", "Unix peer principal does not match the capability subject"))?;
            return Ok(());
        }

        let grant = match self.prepare(&request) {
            Ok(grant) => grant,
            Err(error) => {
                let code = error_code(&error);
                write_frame(stream, &BrokerResponse::denied(invocation_id, code, &error))?;
                return Ok(());
            }
        };
        let mut grant = grant;
        let send_result = match grant.fd.as_ref() {
            Some(fd) => send_frame_with_fd(stream, &grant.response, fd.as_raw_fd()),
            None => write_frame(stream, &grant.response),
        };
        // Drop our copy immediately. For write/network pipes this is necessary for EOF and
        // also prevents the trusted daemon from retaining a duplicate agent-side descriptor.
        grant.fd.take();
        if let Err(send_error) = send_result {
            if let Some(handle) = grant.completion.take() { let _ = handle.join(); }
            let _ = self.finish(&grant.state, "failed", "fd_delivery_failed", Some(send_error.to_string()));
            return Err(send_error);
        }

        let completion = match grant.completion.take() {
            Some(handle) => match handle.join() {
                Ok(result) => result,
                Err(_) => Err(SandboxError::Protocol("broker I/O proxy thread panicked".into())),
            },
            None => Ok(()),
        };
        match completion {
            Ok(()) => self.finish(&grant.state, "completed", "resource_operation_completed", None),
            Err(error) => {
                self.finish(&grant.state, "failed", error_code(&error), Some(error.to_string()))?;
                Err(error)
            }
        }
    }

    fn prepare(&self, request: &CapabilityInvocationRequest) -> Result<BrokerGrant> {
        self.validate_request_identity(request)?;
        let now = (self.deps.now_epoch_ms)();
        if request.deadline_epoch_ms <= now {
            return Err(SandboxError::Denied("invocation deadline has already elapsed".into()));
        }
        if request.sandbox_profile_digest.len() != 64 || !request.sandbox_profile_digest.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
            return Err(SandboxError::InvalidCapability("sandbox profile digest must be lowercase SHA-256 hex".into()));
        }
        let token_digest = request.token.digest()?;
        request.token.verify(
            self.deps.keys.as_ref(),
            &TokenExpectation {
                now_epoch_ms: now,
                subject_principal_id: &request.principal_id,
                mission_id: &request.mission_id,
                audience: &request.audience,
                max_clock_skew_ms: self.deps.maximum_clock_skew_ms,
            },
        )?;
        if request.audience != self.deps.audience || request.runtime_instance_id != self.deps.runtime_instance_id {
            return Err(SandboxError::Denied("request audience/runtime does not match this broker".into()));
        }

        let operation = &request.operation;
        let canonical_digest = operation.canonical_digest()?;
        if !is_digest(&operation.request_digest) || canonical_digest != operation.request_digest {
            return Err(SandboxError::Denied("request digest does not match canonical arguments".into()));
        }
        let scope = resolve_scope(&request.token.payload.scopes, operation)?;
        let effective_budget = request.token.payload.budget.attenuate(&operation.requested_budgets)?;
        if effective_budget.max_wall_clock_ms_per_invocation == 0 ||
            effective_budget.max_cpu_ms_per_invocation == 0 || effective_budget.max_memory_bytes == 0 {
            return Err(SandboxError::Denied("effective execution budget is zero".into()));
        }
        self.deps.policy.assert_current(&request.token, request, &scope)?;
        if self.deps.revocations.is_revoked(
            &request.token.payload.token_id, &token_digest,
            request.token.payload.parent_token_digest.as_deref(), now,
        )? {
            return Err(SandboxError::Denied("capability or an ancestor is revoked in the configured revocation store".into()));
        }
        let reservation = self.deps.quota.reserve(
            &request.token.payload.token_id, &token_digest, &request.invocation_id, &canonical_digest,
            effective_budget.max_invocations, effective_budget.max_concurrent_invocations, now,
        )?;
        let quota_guard = QuotaReservationGuard::new(
            self.deps.quota.clone(), reservation, self.deps.now_epoch_ms.clone(),
        );
        if quota_guard.reservation().reservation_id.is_empty() ||
            quota_guard.reservation().admitted_invocation_number == 0 ||
            quota_guard.reservation().admitted_invocation_number > effective_budget.max_invocations {
            return Err(SandboxError::Protocol("quota store returned an invalid reservation".into()));
        }

        let effective_deadline = request.deadline_epoch_ms
            .min(request.token.payload.expires_at_epoch_ms)
            .min(now.saturating_add(effective_budget.max_wall_clock_ms_per_invocation));
        if effective_deadline <= now {
            return Err(SandboxError::Denied("effective invocation deadline has elapsed".into()));
        }
        let scope_digest = digest_jcs(&scope)?;
        let payload = PreExecutionAttestationPayloadV1 {
            schema: CAPABILITY_ATTESTATION_SCHEMA.into(),
            collector_principal_id: self.deps.collector.principal_id().into(),
            invocation_id: request.invocation_id.clone(),
            token_id: request.token.payload.token_id.clone(),
            token_digest: token_digest.clone(),
            principal_id: request.principal_id.clone(),
            mission_id: request.mission_id.clone(),
            runtime_instance_id: request.runtime_instance_id.clone(),
            audience: request.audience.clone(),
            request_digest: canonical_digest.clone(),
            scope_digest: scope_digest.clone(),
            policy_digest: request.token.payload.policy_digest.clone(),
            sandbox_profile_digest: request.sandbox_profile_digest.clone(),
            reservation_id: quota_guard.reservation().reservation_id.clone(),
            issued_at_epoch_ms: now,
            expires_at_epoch_ms: effective_deadline,
        };
        let signature = self.deps.collector.sign_payload(&jcs_bytes(&payload)?)?;
        if signature.algorithm != "Ed25519" || signature.key_id != self.deps.collector.key_id() {
            return Err(SandboxError::Denied("collector returned an unexpected signature algorithm/key".into()));
        }
        verify_detached_signature(
            &payload, &signature, self.deps.keys.as_ref(), self.deps.collector.principal_id(),
        )?;
        let attestation = PreExecutionAttestationV1 { payload, signature };
        let event = CapabilityEvidenceEvent {
            schema: CAPABILITY_EVIDENCE_SCHEMA.into(),
            event_id: format!("{}:authorized", request.invocation_id),
            kind: "capability-invocation-authorized".into(),
            occurred_at_epoch_ms: now,
            principal_id: request.principal_id.clone(),
            mission_id: request.mission_id.clone(),
            runtime_instance_id: request.runtime_instance_id.clone(),
            token_id: request.token.payload.token_id.clone(),
            token_digest: token_digest.clone(),
            parent_token_digest: request.token.payload.parent_token_digest.clone(),
            invocation_id: Some(request.invocation_id.clone()),
            request_digest: Some(canonical_digest.clone()),
            policy_digest: request.token.payload.policy_digest.clone(),
            pre_execution_attestation: Some(attestation.clone()),
            outcome: "allowed".into(),
            reason_code: "pre_execution_attestation_verified".into(),
            details: json_map([
                ("scopeDigest", json!(scope_digest)),
                ("sandboxProfileDigest", json!(request.sandbox_profile_digest)),
                ("attestationDigest", json!(digest_jcs(&attestation)?)),
                ("reservationId", json!(quota_guard.reservation().reservation_id)),
            ]),
        };
        let authorization_evidence = match self.deps.evidence.append(&event) {
            Ok(receipt) => receipt,
            Err(error) => {
                return Err(SandboxError::KelEvidence(error.to_string()));
            }
        };
        if !is_digest(&authorization_evidence.statement_digest) ||
            authorization_evidence.evidence_id.is_empty() || authorization_evidence.ledger_id.is_empty() {
            return Err(SandboxError::KelEvidence("KEL returned an invalid authorization receipt".into()));
        }
        let state = InvocationState {
            request: request.clone(),
            scope: scope.clone(),
            token_digest: token_digest.clone(),
            request_digest: canonical_digest.clone(),
            quota_guard,
            effective_budget: effective_budget.clone(),
            attestation: attestation.clone(),
            authorization_evidence: authorization_evidence.clone(),
        };

        // No resource is opened/created and no network/process side effect occurs before
        // the signed authorization statement has been accepted by KEL.
        if self.deps.revocations.is_revoked(
            &request.token.payload.token_id, &token_digest,
            request.token.payload.parent_token_digest.as_deref(), (self.deps.now_epoch_ms)(),
        )? {
            let error = SandboxError::Denied("capability or an ancestor was revoked before resource dispatch".into());
            let _ = self.finish(&state, "failed", "capability_revoked", Some(error.to_string()));
            return Err(error);
        }
        let prepared = match self.execute_resource(request, &scope, &effective_budget) {
            Ok(value) => value,
            Err(error) => {
                let _ = self.finish(&state, "failed", error_code(&error), Some(error.to_string()));
                return Err(error);
            }
        };
        let response = BrokerResponse {
            schema: BROKER_RESPONSE_SCHEMA.into(),
            invocation_id: request.invocation_id.clone(),
            allowed: true,
            reason_code: "capability_authorized".into(),
            token_digest: Some(token_digest),
            request_digest: Some(canonical_digest),
            fd_count: if prepared.fd.is_some() { 1 } else { 0 },
            attestation: Some(attestation),
            authorization_evidence: Some(authorization_evidence),
            error: None,
        };
        Ok(BrokerGrant { response, fd: prepared.fd, completion: prepared.completion, state })
    }

    fn validate_request_identity(&self, request: &CapabilityInvocationRequest) -> Result<()> {
        for (label, value) in [
            ("invocationId", request.invocation_id.as_str()),
            ("missionId", request.mission_id.as_str()),
            ("principalId", request.principal_id.as_str()),
            ("runtimeInstanceId", request.runtime_instance_id.as_str()),
            ("audience", request.audience.as_str()),
        ] {
            if value.is_empty() || value.len() > 128 || value.contains('\0') {
                return Err(SandboxError::Protocol(format!("{label} invalid")));
            }
        }
        if request.operation.kind.is_empty() || request.operation.handle_id.is_empty() ||
            request.operation.operation.is_empty() {
            return Err(SandboxError::Protocol("resource operation fields are required".into()));
        }
        Ok(())
    }

    fn execute_resource(
        &self,
        request: &CapabilityInvocationRequest,
        scope: &CapabilityScope,
        budget: &CapabilityBudget,
    ) -> Result<PreparedResource> {
        let operation = &request.operation;
        match (scope, operation.operation.as_str()) {
            (CapabilityScope::Filesystem { resource_id, handle_id, max_bytes_per_invocation, .. }, op)
                if matches!(op, "fs.read" | "fs.list" | "fs.metadata" | "fs.write" | "fs.create" | "fs.delete") => {
                if handle_id != &operation.handle_id {
                    return Err(SandboxError::Denied("filesystem handle mismatch".into()));
                }
                self.execute_filesystem(request, resource_id, max_bytes_per_invocation, budget)
            }
            (CapabilityScope::Network { hosts, ports, max_bytes_per_invocation, .. }, op)
                if matches!(op, "net.resolve" | "net.connect" | "net.send" | "net.receive") => {
                self.execute_network(request, hosts, ports, *max_bytes_per_invocation, budget)
            }
            _ => {
                let provider = self.deps.native_provider.as_ref()
                    .ok_or_else(|| SandboxError::Denied("operation requires a separately configured native isolated-resource provider".into()))?;
                provider.prepare(request, scope, budget)
            }
        }
    }

    fn execute_filesystem(
        &self,
        request: &CapabilityInvocationRequest,
        resource_id: &str,
        scope_max_bytes: &u64,
        budget: &CapabilityBudget,
    ) -> Result<PreparedResource> {
        let operation = &request.operation;
        let selector = &operation.resource_selector;
        let relative = selector.get("relativePath").and_then(Value::as_str)
            .ok_or_else(|| SandboxError::Denied("filesystem resource selector requires relativePath".into()))?;
        if relative.is_empty() || relative.starts_with('/') || relative.contains('\0') ||
            relative.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
            return Err(SandboxError::Denied("filesystem path is not canonical relative syntax".into()));
        }
        let max_bytes = match selector.get("maxBytes") {
            Some(value) => value.as_u64().ok_or_else(|| SandboxError::Denied("maxBytes must be an unsigned integer".into()))?,
            None if operation.operation == "fs.delete" || operation.operation == "fs.metadata" => 0,
            None => return Err(SandboxError::Denied("filesystem operation requires explicit maxBytes".into())),
        };
        if max_bytes > *scope_max_bytes || max_bytes > budget.max_output_bytes || max_bytes > MAX_FD_PAYLOAD_BYTES {
            return Err(SandboxError::BudgetExceeded("filesystem byte limit exceeds scope, output budget or broker maximum".into()));
        }
        let handle_id = &operation.handle_id;
        self.deps.resources.with_directory(handle_id, resource_id, |root| {
            match operation.operation.as_str() {
                "fs.read" => {
                    reject_selector_keys(selector, &["relativePath", "maxBytes"])?;
                    if max_bytes == 0 { return Err(SandboxError::Denied("read byte budget must be positive".into())); }
                    let fd = open_beneath(root, relative, libc::O_RDONLY, 0)?;
                    let file = File::from(fd);
                    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024) as usize);
                    file.take(max_bytes.saturating_add(1)).read_to_end(&mut bytes)?;
                    if bytes.len() as u64 > max_bytes {
                        return Err(SandboxError::BudgetExceeded("file content exceeds requested read ceiling".into()));
                    }
                    Ok(PreparedResource { fd: Some(memfd_snapshot(&bytes)?), completion: None })
                }
                "fs.list" => {
                    reject_selector_keys(selector, &["relativePath", "maxBytes"])?;
                    if max_bytes == 0 { return Err(SandboxError::Denied("listing byte budget must be positive".into())); }
                    let directory = open_beneath(root, relative, libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
                    let bytes = list_directory_snapshot(directory.as_raw_fd(), max_bytes)?;
                    Ok(PreparedResource { fd: Some(memfd_snapshot(&bytes)?), completion: None })
                }
                "fs.metadata" => {
                    reject_selector_keys(selector, &["relativePath"])?;
                    let fd = open_beneath(root, relative, 0x200000, 0)?;
                    Ok(PreparedResource { fd: Some(fd), completion: None })
                }
                "fs.write" | "fs.create" => {
                    reject_selector_keys(selector, &["relativePath", "maxBytes", "contentDigest"])?;
                    if max_bytes == 0 { return Err(SandboxError::Denied("write byte budget must be positive".into())); }
                    let expected_digest = selector.get("contentDigest").and_then(Value::as_str)
                        .ok_or_else(|| SandboxError::Denied("writes require contentDigest".into()))?.to_owned();
                    if !is_digest(&expected_digest) {
                        return Err(SandboxError::Denied("contentDigest must be lowercase SHA-256 hex".into()));
                    }
                    let root_copy = duplicate_fd(root.as_raw_fd())?;
                    let (read_end, write_end) = make_pipe()?;
                    let max = max_bytes;
                    let operation_name = operation.operation.clone();
                    let relative_path = relative.to_owned();
                    let worker = thread::Builder::new().name("klyn-fs-write-guard".into()).spawn(move || {
                        pump_bounded_file_write(
                            read_end, root_copy, relative_path, operation_name, max, expected_digest,
                        )
                    }).map_err(SandboxError::Io)?;
                    Ok(PreparedResource { fd: Some(write_end), completion: Some(worker) })
                }
                "fs.delete" => {
                    reject_selector_keys(selector, &["relativePath"])?;
                    let (parent, name) = split_parent_path(relative);
                    let parent_fd = open_scoped_directory(root, parent)?;
                    let name = CString::new(name).map_err(|_| SandboxError::Denied("filename contains NUL".into()))?;
                    if unsafe { libc::unlinkat(parent_fd.as_raw_fd(), name.as_ptr(), 0) } != 0 {
                        return Err(io::Error::last_os_error().into());
                    }
                    Ok(PreparedResource { fd: None, completion: None })
                }
                _ => Err(SandboxError::Denied("unsupported filesystem operation".into())),
            }
        })
    }

    fn execute_network(
        &self,
        request: &CapabilityInvocationRequest,
        hosts: &[String],
        ports: &[crate::PortRange],
        scope_max_bytes: u64,
        budget: &CapabilityBudget,
    ) -> Result<PreparedResource> {
        let selector = &request.operation.resource_selector;
        reject_selector_keys(selector, &["host", "port", "maxBytes", "payloadDigest"])?;
        let host = selector.get("host").and_then(Value::as_str)
            .ok_or_else(|| SandboxError::Denied("network selector requires exact host".into()))?;
        let port = selector.get("port").and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value != 0)
            .ok_or_else(|| SandboxError::Denied("network selector requires a valid TCP port".into()))?;
        let max_bytes = selector.get("maxBytes").and_then(Value::as_u64)
            .ok_or_else(|| SandboxError::Denied("network selector requires maxBytes".into()))?;
        if !hosts.iter().any(|candidate| candidate == host) ||
            !ports.iter().any(|range| port >= range.first && port <= range.last) {
            return Err(SandboxError::Denied("network destination is outside the signed capability".into()));
        }
        if max_bytes == 0 || max_bytes > scope_max_bytes || max_bytes > budget.max_network_bytes {
            return Err(SandboxError::BudgetExceeded("network byte limit exceeds scope or token budget".into()));
        }
        if request.operation.operation == "net.resolve" {
            let resolved = (host, port).to_socket_addrs()?.filter(|address|
                self.deps.network_policy.allow_destination(host, *address))
                .map(|address| address.to_string()).collect::<Vec<_>>();
            if resolved.is_empty() {
                return Err(SandboxError::Denied("no resolved network address passed destination policy".into()));
            }
            let bytes = serde_json::to_vec(&resolved).map_err(|e| SandboxError::Serialization(e.to_string()))?;
            if bytes.len() as u64 > max_bytes {
                return Err(SandboxError::BudgetExceeded("DNS response exceeds the granted byte limit".into()));
            }
            return Ok(PreparedResource { fd: Some(memfd_snapshot(&bytes)?), completion: None });
        }
        if !matches!(request.operation.operation.as_str(), "net.connect" | "net.send" | "net.receive") {
            return Err(SandboxError::Denied("unsupported network operation".into()));
        }
        if request.operation.operation == "net.send" &&
            selector.get("payloadDigest").and_then(Value::as_str).is_none_or(|digest| !is_digest(digest)) {
            return Err(SandboxError::Denied("network send must bind a payload digest".into()));
        }
        let resolved = (host, port).to_socket_addrs()?
            .filter(|address| self.deps.network_policy.allow_destination(host, *address))
            .collect::<Vec<_>>();
        let mut connected = None;
        for address in resolved {
            match TcpStream::connect_timeout(&address, Duration::from_secs(3)) {
                Ok(stream) => { connected = Some(stream); break; }
                Err(_) => continue,
            }
        }
        let remote = connected.ok_or_else(|| SandboxError::Denied("all permitted network addresses failed to connect".into()))?;
        let (agent_side, broker_side) = UnixStream::pair()?;
        let worker = thread::Builder::new().name("klyn-network-proxy".into())
            .spawn(move || pump_bounded_network(broker_side, remote, max_bytes))
            .map_err(SandboxError::Io)?;
        Ok(PreparedResource {
            fd: Some(unsafe { OwnedFd::from_raw_fd(agent_side.into_raw_fd()) }),
            completion: Some(worker),
        })
    }

    fn finish(&self, state: &InvocationState, outcome: &str, reason_code: &str, error: Option<String>) -> Result<()> {
        let now = (self.deps.now_epoch_ms)();
        let mut details = json_map([
            ("authorizationEvidenceId", json!(state.authorization_evidence.evidence_id)),
            ("reservationId", json!(state.quota_guard.reservation().reservation_id)),
            ("attestationDigest", json!(digest_jcs(&state.attestation)?)),
        ]);
        if let Some(message) = error { details.insert("error".into(), Value::String(message)); }
        let event = CapabilityEvidenceEvent {
            schema: CAPABILITY_EVIDENCE_SCHEMA.into(),
            event_id: format!("{}:{}", state.request.invocation_id, if outcome == "completed" { "completed" } else { "failed" }),
            kind: if outcome == "completed" { "capability-invocation-completed".into() } else { "capability-invocation-failed".into() },
            occurred_at_epoch_ms: now,
            principal_id: state.request.principal_id.clone(),
            mission_id: state.request.mission_id.clone(),
            runtime_instance_id: state.request.runtime_instance_id.clone(),
            token_id: state.request.token.payload.token_id.clone(),
            token_digest: state.token_digest.clone(),
            parent_token_digest: state.request.token.payload.parent_token_digest.clone(),
            invocation_id: Some(state.request.invocation_id.clone()),
            request_digest: Some(state.request_digest.clone()),
            policy_digest: state.request.token.payload.policy_digest.clone(),
            pre_execution_attestation: Some(state.attestation.clone()),
            outcome: outcome.into(),
            reason_code: reason_code.into(),
            details,
        };
        // Quota is never refunded on failure. If evidence append fails, the quota record is
        // still finalized and the caller gets an error for operational reconciliation.
        let evidence_result = self.deps.evidence.append(&event);
        let quota_result = state.quota_guard.finish(outcome, now);
        evidence_result.map_err(|e| SandboxError::KelEvidence(e.to_string()))?;
        quota_result
    }
}

fn resolve_scope(scopes: &[CapabilityScope], operation: &CapabilityResourceRequest) -> Result<CapabilityScope> {
    let mut matches = Vec::new();
    for scope in scopes {
        if scope.kind() != operation.kind || scope.handle_id() != operation.handle_id || !scope.allows(&operation.operation) {
            continue;
        }
        if scope_matches_selector(scope, operation)? { matches.push(scope.clone()); }
    }
    if matches.len() != 1 {
        return Err(SandboxError::Denied(if matches.is_empty() {
            "no single capability scope authorizes this resource operation".into()
        } else {
            "ambiguous overlapping capability scopes are denied".into()
        }));
    }
    Ok(matches.remove(0))
}

fn scope_matches_selector(scope: &CapabilityScope, operation: &CapabilityResourceRequest) -> Result<bool> {
    let selector = &operation.resource_selector;
    match scope {
        CapabilityScope::Filesystem { relative_path_prefix, max_bytes_per_invocation, .. } => {
            let allowed: &[&str] = match operation.operation.as_str() {
                "fs.delete" | "fs.metadata" => &["relativePath"],
                "fs.write" | "fs.create" => &["relativePath", "maxBytes", "contentDigest"],
                _ => &["relativePath", "maxBytes"],
            };
            reject_selector_keys(selector, allowed)?;
            let path = selector.get("relativePath").and_then(Value::as_str)
                .ok_or_else(|| SandboxError::Denied("filesystem selector requires relativePath".into()))?;
            if path.starts_with('/') || path.contains('\0') || path.contains('\\') ||
                path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
                return Err(SandboxError::Denied("filesystem selector path is not canonical".into()));
            }
            if !path_is_within(relative_path_prefix, path) { return Ok(false); }
            if operation.operation != "fs.delete" && operation.operation != "fs.metadata" {
                let max = selector.get("maxBytes").and_then(Value::as_u64)
                    .ok_or_else(|| SandboxError::Denied("filesystem operation requires maxBytes".into()))?;
                if max == 0 || max > *max_bytes_per_invocation || max > MAX_FD_PAYLOAD_BYTES { return Ok(false); }
            }
            if matches!(operation.operation.as_str(), "fs.write" | "fs.create") {
                let digest = selector.get("contentDigest").and_then(Value::as_str)
                    .ok_or_else(|| SandboxError::Denied("filesystem write requires contentDigest".into()))?;
                if !is_digest(digest) { return Ok(false); }
            } else if selector.contains_key("contentDigest") {
                return Ok(false);
            }
            Ok(true)
        }
        CapabilityScope::Network { hosts, ports, max_bytes_per_invocation, operations, .. } => {
            if matches!(operation.operation.as_str(), "net.send" | "net.receive") {
                return Err(SandboxError::Denied("standalone net.send/net.receive are not supported by this stream broker; use net.connect with explicit send and receive grants".into()));
            }
            reject_selector_keys(selector, &["host", "port", "maxBytes"])?;
            let host = selector.get("host").and_then(Value::as_str)
                .ok_or_else(|| SandboxError::Denied("network selector requires host".into()))?;
            let port = selector.get("port").and_then(Value::as_u64).and_then(|n| u16::try_from(n).ok()).unwrap_or(0);
            let max = selector.get("maxBytes").and_then(Value::as_u64)
                .ok_or_else(|| SandboxError::Denied("network selector requires maxBytes".into()))?;
            if !hosts.iter().any(|h| h == host) || !ports.iter().any(|r| port >= r.first && port <= r.last) ||
                max == 0 || max > *max_bytes_per_invocation {
                return Ok(false);
            }
            if operation.operation == "net.connect" &&
                !(operations.iter().any(|op| op == "net.send") && operations.iter().any(|op| op == "net.receive")) {
                return Ok(false);
            }
            Ok(true)
        }
        CapabilityScope::Process { executable_sha256, argv_prefixes, environment_keys, max_processes, .. } => {
            reject_selector_keys(selector, &["processHandleId", "executableSha256", "argv", "environmentKeys", "processCount", "signal"])?;
            if operation.operation != "process.spawn" {
                let handle = selector.get("processHandleId").and_then(Value::as_str)
                    .ok_or_else(|| SandboxError::Denied("process operation requires a broker process handle".into()))?;
                if handle.is_empty() || handle.len() > 128 || handle.contains('\0') { return Ok(false); }
                if operation.operation == "process.signal" {
                    let signal = selector.get("signal").and_then(Value::as_str).unwrap_or("");
                    if !["SIGTERM", "SIGINT", "SIGHUP"].contains(&signal) { return Ok(false); }
                } else if selector.contains_key("signal") {
                    return Ok(false);
                }
                return Ok(selector.get("executableSha256").is_none() &&
                    selector.get("argv").is_none() && selector.get("environmentKeys").is_none() &&
                    selector.get("processCount").is_none());
            }
            let executable = selector.get("executableSha256").and_then(Value::as_str)
                .ok_or_else(|| SandboxError::Denied("process spawn requires executable SHA-256".into()))?;
            let argv = selector.get("argv").and_then(Value::as_array)
                .ok_or_else(|| SandboxError::Denied("process spawn requires argv".into()))?
                .iter().map(|arg| arg.as_str().map(ToOwned::to_owned)
                    .ok_or_else(|| SandboxError::Denied("argv must contain strings".into())))
                .collect::<Result<Vec<_>>>()?;
            let env = selector.get("environmentKeys").and_then(Value::as_array).cloned().unwrap_or_default()
                .iter().map(|key| key.as_str().map(ToOwned::to_owned)
                    .ok_or_else(|| SandboxError::Denied("environment keys must contain strings".into())))
                .collect::<Result<Vec<_>>>()?;
            let processes = selector.get("processCount").and_then(Value::as_u64).unwrap_or(1);
            let request_limit = operation.requested_budgets.max_processes.unwrap_or(*max_processes);
            Ok(executable_sha256.iter().any(|allowed| allowed == executable) &&
                argv_prefixes.iter().any(|prefix| argv.starts_with(prefix)) &&
                env.iter().all(|key| environment_keys.contains(key)) &&
                processes > 0 && processes <= *max_processes && processes <= request_limit)
        }
        CapabilityScope::Memory { region_ids, max_bytes_per_invocation, .. } => {
            reject_selector_keys(selector, &["regionId", "offset", "length"])?;
            let region = selector.get("regionId").and_then(Value::as_str).unwrap_or("");
            let offset = selector.get("offset").and_then(Value::as_u64).unwrap_or(u64::MAX);
            let length = selector.get("length").and_then(Value::as_u64).unwrap_or(u64::MAX);
            Ok(region_ids.iter().any(|id| id == region) && length > 0 &&
                length <= *max_bytes_per_invocation && offset.checked_add(length).is_some() &&
                offset <= 9_007_199_254_740_991 && length <= 9_007_199_254_740_991)
        }
        CapabilityScope::Ipc { channel_ids, peer_principal_ids, max_message_bytes, .. } => {
            reject_selector_keys(selector, &["channelId", "peerPrincipalId", "messageBytes", "payloadDigest"])?;
            let channel = selector.get("channelId").and_then(Value::as_str).unwrap_or("");
            let peer = selector.get("peerPrincipalId").and_then(Value::as_str).unwrap_or("");
            let size = selector.get("messageBytes").and_then(Value::as_u64).unwrap_or(u64::MAX);
            let payload_digest = selector.get("payloadDigest").and_then(Value::as_str);
            if operation.operation == "ipc.send" && payload_digest.is_none_or(|digest| !is_digest(digest)) {
                return Ok(false);
            }
            if operation.operation != "ipc.send" && payload_digest.is_some() { return Ok(false); }
            Ok(channel_ids.iter().any(|id| id == channel) && peer_principal_ids.iter().any(|id| id == peer) && size <= *max_message_bytes)
        }
    }
}

fn reject_selector_keys(selector: &Map<String, Value>, allowed: &[&str]) -> Result<()> {
    if selector.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(SandboxError::Denied("resource selector contains unknown fields".into()));
    }
    Ok(())
}

fn verify_detached_signature<T: Serialize>(
    payload: &T,
    signature: &crate::CapabilitySignatureV1,
    keys: &dyn CapabilityKeyResolver,
    expected_principal_id: &str,
) -> Result<()> {
    if signature.algorithm != "Ed25519" {
        return Err(SandboxError::Denied("only Ed25519 signatures are accepted".into()));
    }
    let trusted = keys.resolve(&signature.key_id)
        .ok_or_else(|| SandboxError::Denied("signature key is not trusted".into()))?;
    if trusted.principal_id != expected_principal_id {
        return Err(SandboxError::Denied("signature key belongs to an unexpected principal".into()));
    }
    let bytes = BASE64.decode(&signature.signature_base64)
        .map_err(|_| SandboxError::Protocol("signature is not Base64".into()))?;
    if BASE64.encode(&bytes) != signature.signature_base64 { return Err(SandboxError::Protocol("signature Base64 is non-canonical".into())); }
    let signature = Signature::from_slice(&bytes).map_err(|_| SandboxError::Protocol("Ed25519 signature length invalid".into()))?;
    let key = VerifyingKey::from_bytes(&trusted.public_key).map_err(|_| SandboxError::Protocol("trusted Ed25519 key invalid".into()))?;
    key.verify(&jcs_bytes(payload)?, &signature).map_err(|_| SandboxError::Denied("runtime attestation signature verification failed".into()))
}

fn json_map<const N: usize>(entries: [(&str, Value); N]) -> Map<String, Value> {
    entries.into_iter().map(|(key, value)| (key.to_owned(), value)).collect()
}

fn is_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn split_parent_path(path: &str) -> (&str, &str) {
    match path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => (".", path),
    }
}

fn error_code(error: &SandboxError) -> &'static str {
    match error {
        SandboxError::Denied(_) => "capability_denied",
        SandboxError::InvalidCapability(_) => "capability_invalid",
        SandboxError::BudgetExceeded(_) => "budget_exceeded",
        SandboxError::UnsupportedKernel(_) => "kernel_feature_unavailable",
        SandboxError::KelEvidence(_) => "kel_evidence_failed",
        SandboxError::Protocol(_) => "broker_protocol_error",
        SandboxError::Serialization(_) => "serialization_error",
        SandboxError::Io(_) => "resource_operation_failed",
    }
}

fn peer_uid(fd: RawFd) -> Result<u32> {
    let mut credentials = std::mem::MaybeUninit::<libc::ucred>::uninit();
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_PEERCRED,
            credentials.as_mut_ptr().cast(), &mut length)
    } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    if length as usize != std::mem::size_of::<libc::ucred>() {
        return Err(SandboxError::Protocol("SO_PEERCRED returned an unexpected size".into()));
    }
    let credentials = unsafe { credentials.assume_init() };
    Ok(credentials.uid)
}

pub struct PrivateBrokerListener {
    pub listener: UnixListener,
    path: PathBuf,
}

impl Drop for PrivateBrokerListener {
    fn drop(&mut self) {
        if let Ok(metadata) = fs::symlink_metadata(&self.path) {
            if metadata.file_type().is_socket() {
                let _ = fs::remove_file(&self.path);
            }
        }
    }
}

pub fn bind_private_socket(path: &Path) -> Result<PrivateBrokerListener> {
    let parent_input = path.parent().ok_or_else(|| SandboxError::Denied("broker socket needs a parent directory".into()))?;
    let parent = fs::canonicalize(parent_input)?;
    let metadata = fs::symlink_metadata(&parent)?;
    if !metadata.file_type().is_dir() || metadata.permissions().mode() & 0o077 != 0 ||
        metadata.uid() != unsafe { libc::geteuid() } {
        return Err(SandboxError::Denied("broker socket parent must be a private, owner-controlled directory".into()));
    }
    let file_name = path.file_name()
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .ok_or_else(|| SandboxError::Denied("broker socket path must end with a regular filename".into()))?;
    let socket_path = parent.join(file_name);
    if let Ok(existing) = fs::symlink_metadata(&socket_path) {
        if !existing.file_type().is_socket() {
            return Err(SandboxError::Denied("refusing to replace a non-socket path".into()));
        }
        fs::remove_file(&socket_path)?;
    }
    let listener = UnixListener::bind(&socket_path)?;
    if let Err(error) = fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)) {
        drop(listener);
        let _ = fs::remove_file(&socket_path);
        return Err(error.into());
    }
    Ok(PrivateBrokerListener { listener, path: socket_path })
}

fn read_frame(stream: &mut UnixStream) -> Result<Vec<u8>> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header)?;
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::Protocol("broker frame length is invalid".into()));
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body)?;
    Ok(body)
}

fn framed<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let body = serde_json::to_vec(value).map_err(|e| SandboxError::Serialization(e.to_string()))?;
    if body.is_empty() || body.len() > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::Protocol("broker response frame length is invalid".into()));
    }
    let mut frame = Vec::with_capacity(body.len() + 4);
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

fn write_frame<T: Serialize>(stream: &mut UnixStream, value: &T) -> Result<()> {
    stream.write_all(&framed(value)?)?;
    Ok(())
}

/// Send one capability response and one restricted FD in the same SCM_RIGHTS message.
/// A partial send is treated as a protocol failure; no retry can duplicate the descriptor.
fn send_frame_with_fd<T: Serialize>(stream: &mut UnixStream, value: &T, fd: RawFd) -> Result<()> {
    let frame = framed(value)?;
    let alignment = std::mem::size_of::<usize>();
    let cmsg_header = std::mem::size_of::<libc::cmsghdr>();
    let data_offset = (cmsg_header + alignment - 1) & !(alignment - 1);
    let cmsg_len = data_offset + std::mem::size_of::<RawFd>();
    let control_len = (cmsg_len + alignment - 1) & !(alignment - 1);
    let mut control = vec![0u8; control_len];
    let mut iov = libc::iovec { iov_base: frame.as_ptr() as *mut libc::c_void, iov_len: frame.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len();
    let header = message.msg_control.cast::<libc::cmsghdr>();
    unsafe {
        (*header).cmsg_len = cmsg_len;
        (*header).cmsg_level = libc::SOL_SOCKET;
        (*header).cmsg_type = libc::SCM_RIGHTS;
        std::ptr::write_unaligned(control.as_mut_ptr().add(data_offset).cast::<RawFd>(), fd);
    }
    let sent = unsafe { libc::sendmsg(stream.as_raw_fd(), &message, libc::MSG_NOSIGNAL) };
    if sent < 0 { return Err(io::Error::last_os_error().into()); }
    if sent as usize != frame.len() {
        return Err(SandboxError::Protocol("partial sendmsg carrying SCM_RIGHTS; FD delivery failed closed".into()));
    }
    Ok(())
}

/// Receive a broker frame and at most one descriptor sent via SCM_RIGHTS. The returned
/// descriptor is close-on-exec. The broker protocol uses one request/response per connection.
pub fn receive_frame_with_fd(stream: &mut UnixStream) -> Result<(Vec<u8>, Option<OwnedFd>)> {
    const MAX_RECEIVED_FDS: usize = 8;
    let alignment = std::mem::size_of::<usize>();
    let header_size = std::mem::size_of::<libc::cmsghdr>();
    let data_offset = (header_size + alignment - 1) & !(alignment - 1);
    let control_size = (data_offset + MAX_RECEIVED_FDS * std::mem::size_of::<RawFd>() + alignment - 1) & !(alignment - 1);
    let mut data = vec![0u8; MAX_BROKER_FRAME_BYTES + 4];
    let mut control = vec![0u8; control_size];
    let mut iov = libc::iovec { iov_base: data.as_mut_ptr().cast(), iov_len: data.len() };
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut iov;
    message.msg_iovlen = 1;
    message.msg_control = control.as_mut_ptr().cast();
    message.msg_controllen = control.len();
    let received = unsafe { libc::recvmsg(stream.as_raw_fd(), &mut message, libc::MSG_CMSG_CLOEXEC) };
    if received < 0 { return Err(io::Error::last_os_error().into()); }
    if received == 0 { return Err(SandboxError::Protocol("broker closed before sending a frame".into())); }

    // Adopt every descriptor received before evaluating the count or truncation flags.
    // This ensures rejected/malicious ancillary data is closed by OwnedFd::drop.
    let control_used = message.msg_controllen.min(control.len());
    let mut received_fds: Vec<OwnedFd> = Vec::new();
    let mut invalid_control = false;
    let mut offset = 0usize;
    while offset.checked_add(header_size).is_some_and(|end| end <= control_used) {
        let header_ptr = unsafe { control.as_ptr().add(offset).cast::<libc::cmsghdr>() };
        let (cmsg_len, cmsg_level, cmsg_type) = unsafe {
            let header = std::ptr::read_unaligned(header_ptr);
            (header.cmsg_len, header.cmsg_level, header.cmsg_type)
        };
        let available = control_used - offset;
        if cmsg_len < data_offset {
            invalid_control = true;
            break;
        }
        let visible_len = cmsg_len.min(available);
        if cmsg_level == libc::SOL_SOCKET && cmsg_type == libc::SCM_RIGHTS {
            let visible_payload = visible_len.saturating_sub(data_offset);
            let count = visible_payload / std::mem::size_of::<RawFd>();
            for index in 0..count {
                let raw_fd = unsafe {
                    std::ptr::read_unaligned(
                        control.as_ptr().add(offset + data_offset + index * std::mem::size_of::<RawFd>())
                            .cast::<RawFd>(),
                    )
                };
                if raw_fd < 0 {
                    invalid_control = true;
                } else {
                    received_fds.push(unsafe { OwnedFd::from_raw_fd(raw_fd) });
                }
            }
            if visible_payload % std::mem::size_of::<RawFd>() != 0 {
                invalid_control = true;
            }
        } else {
            invalid_control = true;
        }

        if cmsg_len > available {
            invalid_control = true;
            break;
        }
        let advance = (cmsg_len + alignment - 1) & !(alignment - 1);
        if advance == 0 || advance > available { break; }
        offset += advance;
    }

    if message.msg_flags & libc::MSG_CTRUNC != 0 || invalid_control {
        return Err(SandboxError::Protocol("truncated or unexpected ancillary control data".into()));
    }
    if received_fds.len() > 1 {
        return Err(SandboxError::Protocol("broker response supplied more than one descriptor".into()));
    }

    let mut used = received as usize;
    if used < 4 {
        stream.read_exact(&mut data[used..4])?;
        used = 4;
    }
    let length = u32::from_be_bytes(data[..4].try_into().expect("four-byte frame header")) as usize;
    if length == 0 || length > MAX_BROKER_FRAME_BYTES {
        return Err(SandboxError::Protocol("broker response length is invalid".into()));
    }
    let expected = 4 + length;
    if used > expected {
        return Err(SandboxError::Protocol("unexpected extra bytes in one-response broker connection".into()));
    }
    if used < expected {
        stream.read_exact(&mut data[used..expected])?;
    }
    Ok((data[4..expected].to_vec(), received_fds.pop()))
}

fn make_pipe() -> Result<(OwnedFd, OwnedFd)> {
    let mut descriptors = [-1; 2];
    if unsafe { libc::pipe2(descriptors.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(unsafe {
        (OwnedFd::from_raw_fd(descriptors[0]), OwnedFd::from_raw_fd(descriptors[1]))
    })
}

fn duplicate_fd(fd: RawFd) -> Result<OwnedFd> {
    let duplicated = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 3) };
    if duplicated < 0 { return Err(io::Error::last_os_error().into()); }
    Ok(unsafe { OwnedFd::from_raw_fd(duplicated) })
}

fn create_staging_memfd() -> Result<File> {
    let name = CString::new("klyn-write-staging").map_err(|e| SandboxError::Protocol(e.to_string()))?;
    let fd = unsafe { libc::syscall(libc::SYS_memfd_create, name.as_ptr(), MEMFD_CLOEXEC | MFD_ALLOW_SEALING) };
    if fd < 0 { return Err(io::Error::last_os_error().into()); }
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd as RawFd) }))
}

fn pump_bounded_file_write(
    read_fd: OwnedFd,
    root_fd: OwnedFd,
    relative_path: String,
    operation: String,
    maximum: u64,
    expected_digest: String,
) -> Result<()> {
    let mut source = File::from(read_fd);
    let mut staging = create_staging_memfd()?;
    let mut hasher = Sha256::new();
    let mut written = 0u64;
    let mut chunk = [0u8; 8192];
    loop {
        let count = source.read(&mut chunk)?;
        if count == 0 { break; }
        let next = written.saturating_add(count as u64);
        if next > maximum {
            return Err(SandboxError::BudgetExceeded("write pipe exceeded byte ceiling; target was not modified".into()));
        }
        hasher.update(&chunk[..count]);
        staging.write_all(&chunk[..count])?;
        written = next;
    }
    staging.flush()?;
    if hex::encode(hasher.finalize()) != expected_digest {
        return Err(SandboxError::Denied("write payload digest mismatch; target was not modified".into()));
    }
    if unsafe { libc::lseek(staging.as_raw_fd(), 0, libc::SEEK_SET) } < 0 {
        return Err(io::Error::last_os_error().into());
    }

    // Resolve the parent directory with openat2, then commit with renameat2 in that
    // same directory. This prevents partially-written targets on quota/digest failures.
    let root = root_fd.as_fd();
    let (parent_path, basename) = split_parent_path(&relative_path);
    if basename.is_empty() || basename == "." || basename == ".." || basename.contains('/') {
        return Err(SandboxError::Denied("write target basename is not canonical".into()));
    }
    let parent_fd = open_scoped_directory(root, parent_path)?;
    let target_name = CString::new(basename)
        .map_err(|_| SandboxError::Denied("write target contains NUL".into()))?;

    if operation == "fs.write" {
        let existing = unsafe {
            libc::openat(
                parent_fd.as_raw_fd(),
                target_name.as_ptr(),
                0x200000 | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if existing < 0 { return Err(io::Error::last_os_error().into()); }
        let existing_fd = unsafe { OwnedFd::from_raw_fd(existing) };
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstat(existing_fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        let stat = unsafe { stat.assume_init() };
        if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
            return Err(SandboxError::Denied("fs.write may replace only an existing regular file".into()));
        }
    } else if operation != "fs.create" {
        return Err(SandboxError::Denied("unsupported staged filesystem mutation".into()));
    }

    let mut random = [0u8; 16];
    let random_count = unsafe {
        libc::syscall(libc::SYS_getrandom, random.as_mut_ptr(), random.len(), 0u32)
    };
    if random_count != random.len() as libc::c_long {
        return Err(SandboxError::UnsupportedKernel("secure temporary-name entropy unavailable".into()));
    }
    let temporary_name = CString::new(format!(".klyn-write-{}", hex::encode(random)))
        .map_err(|e| SandboxError::Protocol(e.to_string()))?;

    let mut temporary_exists = false;
    let commit_result = (|| -> Result<()> {
        let temporary_fd = unsafe {
            libc::openat(
                parent_fd.as_raw_fd(),
                temporary_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if temporary_fd < 0 { return Err(io::Error::last_os_error().into()); }
        temporary_exists = true;
        let mut temporary = unsafe { File::from_raw_fd(temporary_fd) };
        io::copy(&mut staging, &mut temporary)?;
        temporary.flush()?;
        temporary.sync_all()?;
        drop(temporary);

        // RENAME_NOREPLACE makes fs.create atomic without overwriting an existing name.
        // fs.write atomically replaces one existing regular file after its staged payload
        // and digest have been fully verified. There is deliberately no unsafe fallback.
        let rename_flags: u32 = if operation == "fs.create" { 1 } else { 0 };
        let renamed = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                parent_fd.as_raw_fd(),
                temporary_name.as_ptr(),
                parent_fd.as_raw_fd(),
                target_name.as_ptr(),
                rename_flags,
            )
        };
        if renamed != 0 { return Err(io::Error::last_os_error().into()); }
        temporary_exists = false;
        if unsafe { libc::fsync(parent_fd.as_raw_fd()) } != 0 {
            return Err(SandboxError::Io(io::Error::new(
                io::ErrorKind::Other,
                "atomic rename committed but parent-directory fsync failed; durability is uncertain",
            )));
        }
        Ok(())
    })();
    if temporary_exists {
        unsafe { libc::unlinkat(parent_fd.as_raw_fd(), temporary_name.as_ptr(), 0); }
    }
    commit_result
}

fn memfd_snapshot(bytes: &[u8]) -> Result<OwnedFd> {
    if bytes.len() as u64 > MAX_FD_PAYLOAD_BYTES {
        return Err(SandboxError::BudgetExceeded("snapshot exceeds maximum FD payload size".into()));
    }
    let name = CString::new("klyn-capability-snapshot").unwrap();
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("memfd_create syscall is not configured for this architecture".into()));
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        let fd = unsafe { libc::syscall(libc::SYS_memfd_create, name.as_ptr(), MEMFD_CLOEXEC | MFD_ALLOW_SEALING) };
        if fd < 0 { return Err(io::Error::last_os_error().into()); }
        let owned = unsafe { OwnedFd::from_raw_fd(fd as RawFd) };
        let mut file = File::from(owned);
        file.write_all(bytes)?;
        file.flush()?;
        if unsafe { libc::lseek(file.as_raw_fd(), 0, libc::SEEK_SET) } < 0 {
            return Err(io::Error::last_os_error().into());
        }
        let seals = F_SEAL_SEAL | F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE;
        if unsafe { libc::fcntl(file.as_raw_fd(), F_ADD_SEALS, seals) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(unsafe { OwnedFd::from_raw_fd(file.into_raw_fd()) })
    }
}

fn list_directory_snapshot(fd: RawFd, maximum: u64) -> Result<Vec<u8>> {
    let path = PathBuf::from(format!("/proc/self/fd/{fd}"));
    let mut names = Vec::new();
    let mut bytes = 2u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." { continue; }
        bytes = bytes.saturating_add(name.len() as u64 + 4);
        if bytes > maximum || bytes > MAX_FD_PAYLOAD_BYTES {
            return Err(SandboxError::BudgetExceeded("directory listing exceeds the granted byte ceiling".into()));
        }
        names.push(name);
    }
    names.sort();
    let encoded = serde_json::to_vec(&names).map_err(|e| SandboxError::Serialization(e.to_string()))?;
    if encoded.len() as u64 > maximum || encoded.len() as u64 > MAX_FD_PAYLOAD_BYTES {
        return Err(SandboxError::BudgetExceeded("serialized directory listing exceeds byte ceiling".into()));
    }
    Ok(encoded)
}

fn pump_bounded_network(proxy: UnixStream, remote: TcpStream, maximum: u64) -> Result<()> {
    proxy.set_read_timeout(Some(Duration::from_millis(250)))?;
    remote.set_read_timeout(Some(Duration::from_millis(250)))?;
    proxy.set_write_timeout(Some(Duration::from_millis(250)))?;
    remote.set_write_timeout(Some(Duration::from_millis(250)))?;
    let total = Arc::new(AtomicU64::new(0));
    let stopped = Arc::new(AtomicBool::new(false));
    let proxy_read = proxy.try_clone()?;
    let remote_write = remote.try_clone()?;
    let total_a = total.clone();
    let stopped_a = stopped.clone();
    let upstream = thread::Builder::new().name("klyn-net-upstream".into()).spawn(move || {
        relay_limited(proxy_read, remote_write, total_a, stopped_a, maximum)
    })?;
    let total_b = total.clone();
    let stopped_b = stopped.clone();
    let downstream = relay_limited(remote.try_clone()?, proxy.try_clone()?, total_b, stopped_b, maximum);
    stopped.store(true, Ordering::Release);
    let _ = proxy.shutdown(std::net::Shutdown::Both);
    let _ = remote.shutdown(std::net::Shutdown::Both);
    let upstream_result = upstream.join().unwrap_or_else(|_| Err(SandboxError::Protocol("network relay thread panicked".into())));
    downstream?;
    upstream_result?;
    Ok(())
}

fn relay_limited<R: Read, W: Write>(
    mut reader: R,
    mut writer: W,
    total: Arc<AtomicU64>,
    stopped: Arc<AtomicBool>,
    maximum: u64,
) -> Result<()> {
    let mut buffer = [0u8; 8192];
    while !stopped.load(Ordering::Acquire) {
        match reader.read(&mut buffer) {
            Ok(0) => { stopped.store(true, Ordering::Release); break; }
            Ok(count) => {
                let previous = total.fetch_add(count as u64, Ordering::AcqRel);
                if previous.saturating_add(count as u64) > maximum {
                    stopped.store(true, Ordering::Release);
                    return Err(SandboxError::BudgetExceeded("network proxy byte quota exceeded".into()));
                }
                writer.write_all(&buffer[..count])?;
            }
            Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted) => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_meter_rejects_excess_before_forwarding_the_overflowing_chunk() {
        let total = Arc::new(AtomicU64::new(0));
        let stopped = Arc::new(AtomicBool::new(false));
        let mut reader = &b"123456"[..];
        let mut writer = Vec::new();
        let result = relay_limited(&mut reader, &mut writer, total, stopped, 4);
        assert!(result.is_err());
        assert!(writer.is_empty());
    }

    #[test]
    fn memfd_snapshot_is_sealed_and_seekable() {
        let fd = memfd_snapshot(b"bounded snapshot").unwrap();
        let mut file = File::from(fd);
        let mut read_back = String::new();
        file.read_to_string(&mut read_back).unwrap();
        assert_eq!(read_back, "bounded snapshot");
        assert_eq!(unsafe { libc::write(file.as_raw_fd(), b"x".as_ptr().cast(), 1) }, -1);
    }

    #[test]
    fn staged_write_checks_digest_and_atomically_replaces_or_creates() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("existing.txt"), b"original-content").unwrap();
        let root = File::open(temp.path()).unwrap();

        let run_write = |path: &str, op: &str, payload: &[u8], maximum: u64, digest: String| {
            let (read_end, write_end) = make_pipe().unwrap();
            let mut writer = File::from(write_end);
            writer.write_all(payload).unwrap();
            drop(writer);
            pump_bounded_file_write(
                read_end,
                duplicate_fd(root.as_raw_fd()).unwrap(),
                path.to_owned(),
                op.to_owned(),
                maximum,
                digest,
            )
        };

        let rejected = run_write(
            "existing.txt",
            "fs.write",
            b"tampered-payload",
            1024,
            "a".repeat(64),
        );
        assert!(rejected.is_err());
        assert_eq!(std::fs::read(temp.path().join("existing.txt")).unwrap(), b"original-content");

        let update = b"verified-content";
        let digest = hex::encode(Sha256::digest(update));
        run_write("existing.txt", "fs.write", update, 1024, digest).unwrap();
        assert_eq!(std::fs::read(temp.path().join("existing.txt")).unwrap(), update);

        let create = b"new verified file";
        let digest = hex::encode(Sha256::digest(create));
        run_write("new.txt", "fs.create", create, 1024, digest).unwrap();
        assert_eq!(std::fs::read(temp.path().join("new.txt")).unwrap(), create);

        let duplicate_create = b"must not replace";
        let digest = hex::encode(Sha256::digest(duplicate_create));
        assert!(run_write("new.txt", "fs.create", duplicate_create, 1024, digest).is_err());
        assert_eq!(std::fs::read(temp.path().join("new.txt")).unwrap(), create);
    }

    #[test]
    fn selector_unknown_fields_are_rejected() {
        let selector = json!({"relativePath":"repo/src/a.rs","sudo":true}).as_object().unwrap().clone();
        assert!(reject_selector_keys(&selector, &["relativePath"]).is_err());
    }

    #[test]
    fn framed_response_is_length_prefixed_and_bounded() {
        let response = BrokerResponse::denied("test-invocation".into(), "test", "denied");
        let bytes = framed(&response).unwrap();
        assert_eq!(u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize, bytes.len() - 4);
    }

    #[test]
    fn scm_rights_transfers_only_the_authorized_descriptor() {
        let (mut sender, mut receiver) = UnixStream::pair().unwrap();
        let fd = memfd_snapshot(b"restricted capability data").unwrap();
        let response = BrokerResponse {
            schema: BROKER_RESPONSE_SCHEMA.into(),
            invocation_id: "invoke-fd-test".into(),
            allowed: true,
            reason_code: "capability_authorized".into(),
            token_digest: Some("a".repeat(64)),
            request_digest: Some("b".repeat(64)),
            fd_count: 1,
            attestation: None,
            authorization_evidence: None,
            error: None,
        };
        send_frame_with_fd(&mut sender, &response, fd.as_raw_fd()).unwrap();
        let (body, received_fd) = receive_frame_with_fd(&mut receiver).unwrap();
        let decoded: BrokerResponse = serde_json::from_slice(&body).unwrap();
        assert!(decoded.allowed);
        assert_eq!(decoded.fd_count, 1);
        let received_fd = received_fd.expect("SCM_RIGHTS descriptor expected");
        let mut file = File::from(received_fd);
        let mut value = String::new();
        file.read_to_string(&mut value).unwrap();
        assert_eq!(value, "restricted capability data");
    }

    #[test]
    fn peer_credentials_require_kernel_socket_metadata() {
        let (left, _right) = UnixStream::pair().unwrap();
        assert_eq!(peer_uid(left.as_raw_fd()).unwrap(), unsafe { libc::geteuid() });
    }
}
