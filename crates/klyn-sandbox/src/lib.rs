//! Linux kernel-enforced capability sandbox primitives for KLYN OS.
//!
//! This crate is Linux-only. A policy object is not itself a sandbox: a trusted,
//! single-purpose launcher must establish namespaces, apply Landlock and seccomp in
//! the final worker before handing control to untrusted agent code.

#![cfg(target_os = "linux")]

pub mod broker;
pub mod landlock_seccomp;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    os::fd::{AsRawFd, BorrowedFd, RawFd},
    path::{Component, Path, PathBuf},
};
use thiserror::Error;

pub const CAPABILITY_TOKEN_SCHEMA: &str = "urn:klyn:capability-token:v1";
pub const CAPABILITY_EVIDENCE_SCHEMA: &str = "urn:klyn:capability-evidence:v1";
pub const CAPABILITY_ATTESTATION_SCHEMA: &str = "urn:klyn:capability-preexecution-attestation:v1";
pub const BROKER_PROTOCOL_SCHEMA: &str = "urn:klyn:resource-broker-request:v1";
pub const BROKER_RESPONSE_SCHEMA: &str = "urn:klyn:resource-broker-response:v1";
pub const MAX_BROKER_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_FD_PAYLOAD_BYTES: u64 = 16 * 1024 * 1024;
const JS_SAFE_INTEGER_MAX: u64 = 9_007_199_254_740_991;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("I/O failure: {0}")]
    Io(#[from] io::Error),
    #[error("invalid capability: {0}")]
    InvalidCapability(String),
    #[error("capability denied: {0}")]
    Denied(String),
    #[error("unsupported kernel feature: {0}")]
    UnsupportedKernel(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("resource budget exceeded: {0}")]
    BudgetExceeded(String),
    #[error("KEL evidence append/verification failed: {0}")]
    KelEvidence(String),
}

pub type Result<T> = std::result::Result<T, SandboxError>;

pub fn jcs_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_jcs::to_vec(value).map_err(|e| SandboxError::Serialization(e.to_string()))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn digest_jcs<T: Serialize>(value: &T) -> Result<String> {
    Ok(sha256_hex(&jcs_bytes(value)?))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilitySignatureV1 {
    pub algorithm: String,
    pub key_id: String,
    pub signature_base64: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityToken {
    pub payload: CapabilityTokenV1,
    pub signature: CapabilitySignatureV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityTokenV1 {
    pub schema: String,
    pub token_id: String,
    pub issuer_principal_id: String,
    pub subject_principal_id: String,
    pub mission_id: String,
    pub audience: String,
    pub nonce: String,
    pub issued_at_epoch_ms: u64,
    pub not_before_epoch_ms: u64,
    pub expires_at_epoch_ms: u64,
    pub parent_token_digest: Option<String>,
    pub delegation_depth: u32,
    pub delegation: CapabilityDelegationPolicy,
    pub scopes: Vec<CapabilityScope>,
    pub budget: CapabilityBudget,
    pub policy_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityDelegationPolicy {
    pub enabled: bool,
    pub max_depth: u32,
    pub allowed_delegate_principal_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityBudget {
    pub max_invocations: u64,
    pub max_concurrent_invocations: u64,
    pub max_wall_clock_ms_per_invocation: u64,
    pub max_cpu_ms_per_invocation: u64,
    pub max_memory_bytes: u64,
    pub max_network_bytes: u64,
    pub max_output_bytes: u64,
    pub max_processes: u64,
    pub max_financial_spend_minor_units: u64,
}

impl CapabilityBudget {
    pub fn validate(&self) -> Result<()> {
        let fields = [
            ("maxInvocations", self.max_invocations),
            ("maxConcurrentInvocations", self.max_concurrent_invocations),
            ("maxWallClockMsPerInvocation", self.max_wall_clock_ms_per_invocation),
            ("maxCpuMsPerInvocation", self.max_cpu_ms_per_invocation),
            ("maxMemoryBytes", self.max_memory_bytes),
            ("maxNetworkBytes", self.max_network_bytes),
            ("maxOutputBytes", self.max_output_bytes),
            ("maxProcesses", self.max_processes),
            ("maxFinancialSpendMinorUnits", self.max_financial_spend_minor_units),
        ];
        for (name, value) in fields {
            if value > JS_SAFE_INTEGER_MAX {
                return Err(SandboxError::InvalidCapability(format!("{name} exceeds JavaScript safe-integer range")));
            }
        }
        if self.max_invocations == 0 || self.max_concurrent_invocations == 0 ||
            self.max_concurrent_invocations > self.max_invocations {
            return Err(SandboxError::InvalidCapability(
                "invocation quota must be positive and concurrent quota cannot exceed total quota".into(),
            ));
        }
        Ok(())
    }

    pub fn attenuate(&self, requested: &RequestedBudget) -> Result<Self> {
        requested.validate()?;
        let value = Self {
            max_invocations: requested.max_invocations.unwrap_or(self.max_invocations).min(self.max_invocations),
            max_concurrent_invocations: requested.max_concurrent_invocations.unwrap_or(self.max_concurrent_invocations).min(self.max_concurrent_invocations),
            max_wall_clock_ms_per_invocation: requested.max_wall_clock_ms_per_invocation.unwrap_or(self.max_wall_clock_ms_per_invocation).min(self.max_wall_clock_ms_per_invocation),
            max_cpu_ms_per_invocation: requested.max_cpu_ms_per_invocation.unwrap_or(self.max_cpu_ms_per_invocation).min(self.max_cpu_ms_per_invocation),
            max_memory_bytes: requested.max_memory_bytes.unwrap_or(self.max_memory_bytes).min(self.max_memory_bytes),
            max_network_bytes: requested.max_network_bytes.unwrap_or(self.max_network_bytes).min(self.max_network_bytes),
            max_output_bytes: requested.max_output_bytes.unwrap_or(self.max_output_bytes).min(self.max_output_bytes),
            max_processes: requested.max_processes.unwrap_or(self.max_processes).min(self.max_processes),
            max_financial_spend_minor_units: requested.max_financial_spend_minor_units.unwrap_or(self.max_financial_spend_minor_units).min(self.max_financial_spend_minor_units),
        };
        value.validate()?;
        Ok(value)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestedBudget {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_invocations: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrent_invocations: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_wall_clock_ms_per_invocation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_cpu_ms_per_invocation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_network_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_processes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_financial_spend_minor_units: Option<u64>,
}

impl RequestedBudget {
    fn validate(&self) -> Result<()> {
        let fields = [
            ("maxInvocations", self.max_invocations),
            ("maxConcurrentInvocations", self.max_concurrent_invocations),
            ("maxWallClockMsPerInvocation", self.max_wall_clock_ms_per_invocation),
            ("maxCpuMsPerInvocation", self.max_cpu_ms_per_invocation),
            ("maxMemoryBytes", self.max_memory_bytes),
            ("maxNetworkBytes", self.max_network_bytes),
            ("maxOutputBytes", self.max_output_bytes),
            ("maxProcesses", self.max_processes),
            ("maxFinancialSpendMinorUnits", self.max_financial_spend_minor_units),
        ];
        for (name, value) in fields {
            if value.is_some_and(|v| v > JS_SAFE_INTEGER_MAX) {
                return Err(SandboxError::InvalidCapability(format!("requested budget {name} is invalid")));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PortRange {
    pub first: u16,
    pub last: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum CapabilityScope {
    Filesystem {
        #[serde(rename = "handleId")]
        handle_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        operations: Vec<String>,
        #[serde(rename = "relativePathPrefix")]
        relative_path_prefix: String,
        #[serde(rename = "maxBytesPerInvocation")]
        max_bytes_per_invocation: u64,
    },
    Network {
        #[serde(rename = "handleId")]
        handle_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        operations: Vec<String>,
        hosts: Vec<String>,
        ports: Vec<PortRange>,
        #[serde(rename = "maxBytesPerInvocation")]
        max_bytes_per_invocation: u64,
    },
    Process {
        #[serde(rename = "handleId")]
        handle_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        operations: Vec<String>,
        #[serde(rename = "executableSha256")]
        executable_sha256: Vec<String>,
        #[serde(rename = "argvPrefixes")]
        argv_prefixes: Vec<Vec<String>>,
        #[serde(rename = "environmentKeys")]
        environment_keys: Vec<String>,
        #[serde(rename = "maxProcesses")]
        max_processes: u64,
    },
    Memory {
        #[serde(rename = "handleId")]
        handle_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        operations: Vec<String>,
        #[serde(rename = "regionIds")]
        region_ids: Vec<String>,
        #[serde(rename = "maxBytesPerInvocation")]
        max_bytes_per_invocation: u64,
    },
    Ipc {
        #[serde(rename = "handleId")]
        handle_id: String,
        #[serde(rename = "resourceId")]
        resource_id: String,
        operations: Vec<String>,
        #[serde(rename = "channelIds")]
        channel_ids: Vec<String>,
        #[serde(rename = "peerPrincipalIds")]
        peer_principal_ids: Vec<String>,
        #[serde(rename = "maxMessageBytes")]
        max_message_bytes: u64,
    },
}

impl CapabilityScope {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Filesystem { .. } => "filesystem",
            Self::Network { .. } => "network",
            Self::Process { .. } => "process",
            Self::Memory { .. } => "memory",
            Self::Ipc { .. } => "ipc",
        }
    }

    pub fn handle_id(&self) -> &str {
        match self {
            Self::Filesystem { handle_id, .. } | Self::Network { handle_id, .. } |
            Self::Process { handle_id, .. } | Self::Memory { handle_id, .. } |
            Self::Ipc { handle_id, .. } => handle_id,
        }
    }

    pub fn resource_id(&self) -> &str {
        match self {
            Self::Filesystem { resource_id, .. } | Self::Network { resource_id, .. } |
            Self::Process { resource_id, .. } | Self::Memory { resource_id, .. } |
            Self::Ipc { resource_id, .. } => resource_id,
        }
    }

    pub fn operations(&self) -> &[String] {
        match self {
            Self::Filesystem { operations, .. } | Self::Network { operations, .. } |
            Self::Process { operations, .. } | Self::Memory { operations, .. } |
            Self::Ipc { operations, .. } => operations,
        }
    }

    pub fn allows(&self, operation: &str) -> bool {
        self.operations().iter().any(|candidate| candidate == operation)
    }

    pub fn validate(&self) -> Result<()> {
        valid_id(self.handle_id(), "scope.handleId")?;
        valid_id(self.resource_id(), "scope.resourceId")?;
        let allowed: &[&str] = match self {
            Self::Filesystem { relative_path_prefix, max_bytes_per_invocation, .. } => {
                validate_relative_path(relative_path_prefix, true)?;
                if *max_bytes_per_invocation > JS_SAFE_INTEGER_MAX {
                    return Err(SandboxError::InvalidCapability("filesystem byte budget is out of range".into()));
                }
                &["fs.read", "fs.list", "fs.metadata", "fs.write", "fs.create", "fs.delete"]
            }
            Self::Network { hosts, ports, max_bytes_per_invocation, .. } => {
                if hosts.is_empty() || ports.is_empty() || *max_bytes_per_invocation > JS_SAFE_INTEGER_MAX {
                    return Err(SandboxError::InvalidCapability("network scope requires hosts, ports and a valid byte limit".into()));
                }
                ensure_unique(hosts, "scope.hosts")?;
                for host in hosts {
                    if !is_canonical_host(host) {
                        return Err(SandboxError::InvalidCapability("network scope contains a non-canonical host".into()));
                    }
                }
                for port in ports {
                    if port.first == 0 || port.last < port.first {
                        return Err(SandboxError::InvalidCapability("network port range is invalid".into()));
                    }
                }
                &["net.resolve", "net.connect", "net.send", "net.receive"]
            }
            Self::Process { executable_sha256, argv_prefixes, environment_keys, max_processes, .. } => {
                if executable_sha256.is_empty() || argv_prefixes.is_empty() || *max_processes > JS_SAFE_INTEGER_MAX {
                    return Err(SandboxError::InvalidCapability("process scope requires explicit executables and argv prefixes".into()));
                }
                ensure_unique(executable_sha256, "scope.executableSha256")?;
                if executable_sha256.iter().any(|digest| !is_hex_digest(digest)) {
                    return Err(SandboxError::InvalidCapability("executable hash must be SHA-256 hex".into()));
                }
                for prefix in argv_prefixes {
                    if prefix.is_empty() || prefix.iter().any(|arg| arg.contains('\0')) {
                        return Err(SandboxError::InvalidCapability("process argv prefixes must be non-empty and contain no NUL".into()));
                    }
                }
                if !environment_keys.is_empty() { ensure_unique(environment_keys, "scope.environmentKeys")?; }
                &["process.spawn", "process.inspect", "process.signal", "process.terminate"]
            }
            Self::Memory { region_ids, max_bytes_per_invocation, .. } => {
                ensure_unique(region_ids, "scope.regionIds")?;
                if *max_bytes_per_invocation > JS_SAFE_INTEGER_MAX {
                    return Err(SandboxError::InvalidCapability("memory byte budget is out of range".into()));
                }
                &["memory.read", "memory.write"]
            }
            Self::Ipc { channel_ids, peer_principal_ids, max_message_bytes, .. } => {
                ensure_unique(channel_ids, "scope.channelIds")?;
                ensure_unique(peer_principal_ids, "scope.peerPrincipalIds")?;
                if *max_message_bytes > JS_SAFE_INTEGER_MAX {
                    return Err(SandboxError::InvalidCapability("IPC byte budget is out of range".into()));
                }
                &["ipc.send", "ipc.receive"]
            }
        };
        if self.operations().is_empty() {
            return Err(SandboxError::InvalidCapability("scope operations cannot be empty".into()));
        }
        ensure_unique(self.operations(), "scope.operations")?;
        for operation in self.operations() {
            if !allowed.contains(&operation.as_str()) {
                return Err(SandboxError::InvalidCapability(format!("operation {operation} is invalid for {}", self.kind())));
            }
        }
        Ok(())
    }
}

fn valid_id(value: &str, field: &str) -> Result<()> {
    if value.is_empty() || value.len() > 128 ||
        !value.as_bytes()[0].is_ascii_alphanumeric() ||
        !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b)) {
        return Err(SandboxError::InvalidCapability(format!("{field} must be a canonical identifier")));
    }
    Ok(())
}

fn ensure_unique(values: &[String], label: &str) -> Result<()> {
    if values.is_empty() {
        return Err(SandboxError::InvalidCapability(format!("{label} cannot be empty")));
    }
    let mut sorted = values.to_vec();
    sorted.sort();
    sorted.dedup();
    if sorted.len() != values.len() || values.iter().any(|value| value.contains('*') || value.contains('\0')) {
        return Err(SandboxError::InvalidCapability(format!("{label} contains duplicates or wildcard values")));
    }
    Ok(())
}

fn validate_relative_path(path: &str, allow_empty: bool) -> Result<()> {
    if path.is_empty() && allow_empty { return Ok(()); }
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return Err(SandboxError::InvalidCapability("path must be canonical and relative".into()));
    }
    if path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(SandboxError::InvalidCapability("path traversal and empty segments are forbidden".into()));
    }
    let candidate = Path::new(path);
    if candidate.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(SandboxError::InvalidCapability("path contains a non-normal component".into()));
    }
    Ok(())
}

pub fn path_is_within(prefix: &str, candidate: &str) -> bool {
    prefix.is_empty() || candidate == prefix ||
        candidate.strip_prefix(prefix).is_some_and(|tail| tail.starts_with('/'))
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn is_canonical_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || host != host.to_ascii_lowercase() || host.ends_with('.') {
        return false;
    }
    if host.parse::<std::net::IpAddr>().is_ok() { return true; }
    host.split('.').all(|label| {
        let bytes = label.as_bytes();
        !bytes.is_empty() && bytes.len() <= 63 &&
        (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) &&
        (bytes[bytes.len() - 1].is_ascii_lowercase() || bytes[bytes.len() - 1].is_ascii_digit()) &&
        bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    })
}

pub trait CapabilityKeyResolver: Send + Sync {
    fn resolve(&self, key_id: &str) -> Option<TrustedCapabilityKey>;
}

#[derive(Clone, Debug)]
pub struct TrustedCapabilityKey {
    pub principal_id: String,
    pub public_key: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct TokenExpectation<'a> {
    pub now_epoch_ms: u64,
    pub subject_principal_id: &'a str,
    pub mission_id: &'a str,
    pub audience: &'a str,
    pub max_clock_skew_ms: u64,
}

impl CapabilityToken {
    pub fn digest(&self) -> Result<String> { digest_jcs(self) }

    pub fn verify(&self, keys: &dyn CapabilityKeyResolver, expected: &TokenExpectation<'_>) -> Result<()> {
        let payload = &self.payload;
        if payload.schema != CAPABILITY_TOKEN_SCHEMA {
            return Err(SandboxError::InvalidCapability("unsupported token schema".into()));
        }
        for (name, value) in [
            ("tokenId", payload.token_id.as_str()),
            ("issuerPrincipalId", payload.issuer_principal_id.as_str()),
            ("subjectPrincipalId", payload.subject_principal_id.as_str()),
            ("missionId", payload.mission_id.as_str()),
            ("audience", payload.audience.as_str()),
            ("nonce", payload.nonce.as_str()),
        ] {
            valid_id(value, name)?;
        }
        if !is_hex_digest(&payload.policy_digest) {
            return Err(SandboxError::InvalidCapability("policyDigest must be lowercase SHA-256 hex".into()));
        }
        payload.budget.validate()?;
        if payload.scopes.is_empty() {
            return Err(SandboxError::InvalidCapability("capability has no scopes".into()));
        }
        for scope in &payload.scopes { scope.validate()?; }
        if payload.expires_at_epoch_ms <= payload.issued_at_epoch_ms ||
            payload.not_before_epoch_ms < payload.issued_at_epoch_ms ||
            payload.not_before_epoch_ms >= payload.expires_at_epoch_ms {
            return Err(SandboxError::InvalidCapability("token time bounds are inconsistent".into()));
        }
        if payload.parent_token_digest.as_ref().is_some_and(|digest| !is_hex_digest(digest)) {
            return Err(SandboxError::InvalidCapability("parent token digest is malformed".into()));
        }
        if payload.parent_token_digest.is_none() != (payload.delegation_depth == 0) {
            return Err(SandboxError::InvalidCapability("root token/delegation depth mismatch".into()));
        }
        if payload.delegation.max_depth < payload.delegation_depth ||
            (payload.delegation.enabled && payload.delegation.max_depth <= payload.delegation_depth) {
            return Err(SandboxError::InvalidCapability("delegation depth exceeds policy".into()));
        }
        if payload.delegation.enabled {
            ensure_unique(&payload.delegation.allowed_delegate_principal_ids, "delegation allowlist")?;
        } else if !payload.delegation.allowed_delegate_principal_ids.is_empty() {
            return Err(SandboxError::InvalidCapability("disabled delegation must have an empty allowlist".into()));
        }
        if payload.issued_at_epoch_ms > JS_SAFE_INTEGER_MAX ||
            payload.not_before_epoch_ms > JS_SAFE_INTEGER_MAX ||
            payload.expires_at_epoch_ms > JS_SAFE_INTEGER_MAX {
            return Err(SandboxError::InvalidCapability("token timestamps exceed JavaScript safe-integer range".into()));
        }

        let trusted = keys.resolve(&self.signature.key_id)
            .ok_or_else(|| SandboxError::Denied("capability signing key is not trusted".into()))?;
        if trusted.principal_id != payload.issuer_principal_id {
            return Err(SandboxError::Denied("signing key is not registered to the claimed issuer".into()));
        }
        if self.signature.algorithm != "Ed25519" {
            return Err(SandboxError::InvalidCapability("only Ed25519 token signatures are accepted".into()));
        }
        let sig_bytes = BASE64.decode(&self.signature.signature_base64)
            .map_err(|_| SandboxError::InvalidCapability("signature is not canonical Base64".into()))?;
        if BASE64.encode(&sig_bytes) != self.signature.signature_base64 {
            return Err(SandboxError::InvalidCapability("signature is not canonical Base64".into()));
        }
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|_| SandboxError::InvalidCapability("Ed25519 signature must be exactly 64 bytes".into()))?;
        let public_key = VerifyingKey::from_bytes(&trusted.public_key)
            .map_err(|_| SandboxError::InvalidCapability("trusted Ed25519 public key is invalid".into()))?;
        public_key.verify(&jcs_bytes(payload)?, &signature)
            .map_err(|_| SandboxError::Denied("capability signature verification failed".into()))?;

        let now = expected.now_epoch_ms;
        if now.saturating_add(expected.max_clock_skew_ms) < payload.not_before_epoch_ms {
            return Err(SandboxError::Denied("capability is not active yet".into()));
        }
        if now.saturating_sub(expected.max_clock_skew_ms) >= payload.expires_at_epoch_ms {
            return Err(SandboxError::Denied("capability has expired".into()));
        }
        if payload.subject_principal_id != expected.subject_principal_id ||
            payload.mission_id != expected.mission_id || payload.audience != expected.audience {
            return Err(SandboxError::Denied("capability subject, mission or audience mismatch".into()));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityResourceRequest {
    pub kind: String,
    pub handle_id: String,
    pub operation: String,
    pub request_digest: String,
    pub resource_selector: serde_json::Map<String, serde_json::Value>,
    pub requested_budgets: RequestedBudget,
}

impl CapabilityResourceRequest {
    pub fn canonical_digest(&self) -> Result<String> {
        let value = serde_json::json!({
            "kind": self.kind,
            "handleId": self.handle_id,
            "operation": self.operation,
            "resourceSelector": self.resource_selector,
            "requestedBudgets": self.requested_budgets,
        });
        digest_jcs(&value)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityInvocationRequest {
    pub invocation_id: String,
    pub mission_id: String,
    pub principal_id: String,
    pub runtime_instance_id: String,
    pub audience: String,
    pub token: CapabilityToken,
    pub operation: CapabilityResourceRequest,
    pub deadline_epoch_ms: u64,
    pub sandbox_profile_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreExecutionAttestationPayloadV1 {
    pub schema: String,
    pub collector_principal_id: String,
    pub invocation_id: String,
    pub token_id: String,
    pub token_digest: String,
    pub principal_id: String,
    pub mission_id: String,
    pub runtime_instance_id: String,
    pub audience: String,
    pub request_digest: String,
    pub scope_digest: String,
    pub policy_digest: String,
    pub sandbox_profile_digest: String,
    pub reservation_id: String,
    pub issued_at_epoch_ms: u64,
    pub expires_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreExecutionAttestationV1 {
    pub payload: PreExecutionAttestationPayloadV1,
    pub signature: CapabilitySignatureV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceReceipt {
    pub ledger_id: String,
    pub evidence_id: String,
    pub statement_digest: String,
    pub committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityEvidenceEvent {
    pub schema: String,
    pub event_id: String,
    pub kind: String,
    pub occurred_at_epoch_ms: u64,
    pub principal_id: String,
    pub mission_id: String,
    pub runtime_instance_id: String,
    pub token_id: String,
    pub token_digest: String,
    pub parent_token_digest: Option<String>,
    pub invocation_id: Option<String>,
    pub request_digest: Option<String>,
    pub policy_digest: String,
    pub pre_execution_attestation: Option<PreExecutionAttestationV1>,
    pub outcome: String,
    pub reason_code: String,
    pub details: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug)]
pub struct NamespaceProfile {
    pub user: bool,
    pub mount: bool,
    pub pid: bool,
    pub network: bool,
    pub ipc: bool,
    pub uts: bool,
}

impl NamespaceProfile {
    pub fn strict_agent() -> Self {
        Self { user: true, mount: true, pid: true, network: true, ipc: true, uts: true }
    }

    pub fn validate(&self) -> Result<()> {
        if !(self.user && self.mount && self.pid && self.network && self.ipc && self.uts) {
            return Err(SandboxError::Denied("production agent policy requires user, mount, PID, network, IPC and UTS namespaces".into()));
        }
        Ok(())
    }
}

/// Run in a dedicated disposable launcher process. CLONE_NEWPID affects future
/// children, so the launcher must fork the final worker next. The final child then
/// applies Landlock and seccomp before untrusted code begins.
pub fn enter_namespaces_for_next_child(profile: &NamespaceProfile) -> Result<()> {
    profile.validate()?;
    let uid = unsafe { libc::geteuid() };
    let gid = unsafe { libc::getegid() };
    if profile.user {
        if unsafe { libc::unshare(libc::CLONE_NEWUSER) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        fs::write("/proc/self/setgroups", "deny")?;
        fs::write("/proc/self/uid_map", format!("0 {uid} 1"))?;
        fs::write("/proc/self/gid_map", format!("0 {gid} 1"))?;
    }
    let mut flags = 0;
    if profile.mount { flags |= libc::CLONE_NEWNS; }
    if profile.network { flags |= libc::CLONE_NEWNET; }
    if profile.ipc { flags |= libc::CLONE_NEWIPC; }
    if profile.uts { flags |= libc::CLONE_NEWUTS; }
    if profile.pid { flags |= libc::CLONE_NEWPID; }
    if unsafe { libc::unshare(flags) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    if profile.mount && unsafe {
        libc::mount(std::ptr::null(), b"/\0".as_ptr().cast(), std::ptr::null(),
            (libc::MS_REC | libc::MS_PRIVATE) as libc::c_ulong, std::ptr::null())
    } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct CgroupIoLimit {
    pub major: u32,
    pub minor: u32,
    pub read_bps: Option<u64>,
    pub write_bps: Option<u64>,
    pub read_iops: Option<u64>,
    pub write_iops: Option<u64>,
}

impl CgroupIoLimit {
    fn format_line(&self) -> Result<String> {
        if self.read_bps.is_none() && self.write_bps.is_none() &&
            self.read_iops.is_none() && self.write_iops.is_none() {
            return Err(SandboxError::InvalidCapability("io.max limit must specify a device budget".into()));
        }
        let mut fields = Vec::new();
        if let Some(value) = self.read_bps { fields.push(format!("rbps={value}")); }
        if let Some(value) = self.write_bps { fields.push(format!("wbps={value}")); }
        if let Some(value) = self.read_iops { fields.push(format!("riops={value}")); }
        if let Some(value) = self.write_iops { fields.push(format!("wiops={value}")); }
        Ok(format!("{}:{} {}", self.major, self.minor, fields.join(" ")))
    }
}

/// cpu.max is a rate ceiling; maxCpuMsPerInvocation is enforced separately from
/// cpu.stat. io.max needs explicit block-device limits; output bytes are not silently
/// reinterpreted as disk I/O.
pub struct CgroupV2 {
    path: PathBuf,
    cpu_budget_ms: u64,
}

impl CgroupV2 {
    pub fn create(
        delegated_root: &Path,
        name: &str,
        budget: &CapabilityBudget,
        io_limit: Option<&CgroupIoLimit>,
        cpu_quota_us: u64,
        cpu_period_us: u64,
    ) -> Result<Self> {
        budget.validate()?;
        valid_id(name, "cgroup name")?;
        if cpu_quota_us == 0 || cpu_period_us == 0 || cpu_quota_us > cpu_period_us.saturating_mul(1_000) {
            return Err(SandboxError::InvalidCapability("cpu.max quota/period is invalid".into()));
        }
        let root = fs::canonicalize(delegated_root)?;
        if !fs::metadata(&root)?.is_dir() {
            return Err(SandboxError::Denied("cgroup root is not a directory".into()));
        }
        let path = root.join(name);
        fs::create_dir(&path)?;
        let configured = (|| -> Result<()> {
            write_control(&path, "memory.max", &budget.max_memory_bytes.to_string())?;
            write_control(&path, "memory.swap.max", "0")?;
            write_control(&path, "cpu.max", &format!("{cpu_quota_us} {cpu_period_us}"))?;
            write_control(&path, "pids.max", &budget.max_processes.saturating_add(1).to_string())?;
            if let Some(limit) = io_limit { write_control(&path, "io.max", &limit.format_line()?)?; }
            Ok(())
        })();
        if let Err(error) = configured {
            let _ = fs::remove_dir(&path);
            return Err(error);
        }
        Ok(Self { path, cpu_budget_ms: budget.max_cpu_ms_per_invocation })
    }

    pub fn path(&self) -> &Path { &self.path }

    /// Must be called while the worker is blocked on a launch gate, before exec.
    pub fn attach_paused_pid(&self, pid: libc::pid_t) -> Result<()> {
        if pid <= 0 { return Err(SandboxError::Denied("invalid worker PID".into())); }
        write_control(&self.path, "cgroup.procs", &pid.to_string())
    }

    pub fn cpu_usage_micros(&self) -> Result<u64> {
        let stat = fs::read_to_string(self.path.join("cpu.stat"))?;
        stat.lines().find_map(|line| {
            let mut pieces = line.split_whitespace();
            if pieces.next()? == "usage_usec" { pieces.next()?.parse::<u64>().ok() } else { None }
        }).ok_or_else(|| SandboxError::Protocol("cpu.stat lacks usage_usec".into()))
    }

    pub fn enforce_cpu_budget(&self) -> Result<()> {
        if self.cpu_usage_micros()? / 1_000 > self.cpu_budget_ms {
            self.kill_all()?;
            return Err(SandboxError::BudgetExceeded("CPU-time budget exceeded; cgroup killed".into()));
        }
        Ok(())
    }

    pub fn kill_all(&self) -> Result<()> { write_control(&self.path, "cgroup.kill", "1") }

    pub fn cleanup(self) -> Result<()> {
        let events = fs::read_to_string(self.path.join("cgroup.events"))?;
        if !events.lines().any(|line| line == "populated 0") {
            return Err(SandboxError::Denied("refusing to remove a populated cgroup".into()));
        }
        fs::remove_dir(&self.path)?;
        Ok(())
    }
}

fn write_control(path: &Path, file: &str, value: &str) -> Result<()> {
    let target = path.join(file);
    if !target.exists() {
        return Err(SandboxError::UnsupportedKernel(format!("required cgroup-v2 controller file {file} is unavailable")));
    }
    let mut handle = fs::OpenOptions::new().write(true).open(target)?;
    handle.write_all(value.as_bytes())?;
    Ok(())
}

pub fn close_unlisted_fds(keep: &[RawFd]) -> Result<()> {
    let mut allowed = keep.to_vec();
    allowed.sort_unstable();
    allowed.dedup();
    if allowed.iter().any(|fd| *fd < 3) {
        return Err(SandboxError::Denied("standard descriptors are managed separately".into()));
    }
    let mut start: u32 = 3;
    for fd in allowed {
        let current = fd as u32;
        if current > start { close_range(start, current - 1)?; }
        start = current.saturating_add(1);
    }
    close_range(start, u32::MAX)
}

fn close_range(first: u32, last: u32) -> Result<()> {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    let number = libc::SYS_close_range;
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    return Err(SandboxError::UnsupportedKernel("close_range unsupported on this architecture".into()));
    #[allow(unreachable_code)]
    let result = unsafe { libc::syscall(number, first, last, 0u32) };
    if result != 0 { return Err(io::Error::last_os_error().into()); }
    Ok(())
}

pub fn validate_directory_fd(fd: BorrowedFd<'_>) -> Result<()> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    let stat = unsafe { stat.assume_init() };
    if (stat.st_mode & libc::S_IFMT) != libc::S_IFDIR {
        return Err(SandboxError::Denied("registered resource FD is not a directory".into()));
    }
    let descriptor_flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFD) };
    if descriptor_flags < 0 { return Err(io::Error::last_os_error().into()); }
    if descriptor_flags & libc::FD_CLOEXEC == 0 {
        return Err(SandboxError::Denied("registered root FD must be close-on-exec".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_boundary_rejects_prefix_collision_and_traversal() {
        assert!(path_is_within("repo/src", "repo/src/main.rs"));
        assert!(path_is_within("repo/src", "repo/src"));
        assert!(!path_is_within("repo/src", "repo/src-evil/file"));
        assert!(validate_relative_path("../outside", false).is_err());
        assert!(validate_relative_path("repo//src", false).is_err());
    }

    #[test]
    fn scopes_reject_wildcards_and_unknown_operations() {
        let scope = CapabilityScope::Filesystem {
            handle_id: "fs-handle-1".into(), resource_id: "workspace-1".into(),
            operations: vec!["fs.read".into(), "fs.write*".into()],
            relative_path_prefix: "repo/src".into(), max_bytes_per_invocation: 1024,
        };
        assert!(scope.validate().is_err());
    }

    #[test]
    fn requested_budget_only_reduces_grants() {
        let granted = CapabilityBudget {
            max_invocations: 10, max_concurrent_invocations: 2,
            max_wall_clock_ms_per_invocation: 30_000, max_cpu_ms_per_invocation: 5_000,
            max_memory_bytes: 128 * 1024 * 1024, max_network_bytes: 8192,
            max_output_bytes: 8192, max_processes: 2, max_financial_spend_minor_units: 0,
        };
        let request = RequestedBudget { max_network_bytes: Some(1024), ..Default::default() };
        assert_eq!(granted.attenuate(&request).unwrap().max_network_bytes, 1024);
        let denied = RequestedBudget { max_memory_bytes: Some(u64::MAX), ..Default::default() };
        assert!(granted.attenuate(&denied).is_err());
    }

    #[test]
    fn cgroup_cpu_stat_format_has_cumulative_counter() {
        let fixture = "usage_usec 12345\nuser_usec 9000\nsystem_usec 3345\n";
        let value = fixture.lines().find_map(|line| {
            let mut pieces = line.split_whitespace();
            if pieces.next()? == "usage_usec" { pieces.next()?.parse::<u64>().ok() } else { None }
        });
        assert_eq!(value, Some(12345));
    }

    #[test]
    fn strict_namespace_profile_requires_all_namespaces() {
        assert!(NamespaceProfile::strict_agent().validate().is_ok());
        let weaker = NamespaceProfile { network: false, ..NamespaceProfile::strict_agent() };
        assert!(weaker.validate().is_err());
    }
}
