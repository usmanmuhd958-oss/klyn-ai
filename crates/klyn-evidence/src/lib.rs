//! KLYN Evidence Ledger (KEL) v1 protocol primitives.
//!
//! The wire contract uses RFC 8785 JSON Canonicalization Scheme (JCS), DSSE
//! pre-authentication encoding, SHA-256 and the ordered Merkle Tree Hash from
//! RFC 9162. This crate intentionally does not own key storage or trust policy.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use thiserror::Error;

pub const EVIDENCE_SCHEMA: &str = "urn:klyn:evidence:v1";
pub const LEAF_SCHEMA: &str = "urn:klyn:ledger-leaf:v1";
pub const TREE_HEAD_SCHEMA: &str = "urn:klyn:tree-head:v1";
pub const EVIDENCE_PAYLOAD_TYPE: &str = "application/vnd.klyn.evidence.v1+json";
pub const TREE_HEAD_PAYLOAD_TYPE: &str = "application/vnd.klyn.tree-head.v1+json";
pub const HASH_ALGORITHM: &str = "sha256";
pub const TREE_ALGORITHM: &str = "rfc9162-sha256";

#[derive(Debug, Error)]
pub enum KelError {
    #[error("canonicalization failed: {0}")]
    Canonicalization(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("base64 decoding failed: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("JSON decoding failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("signature verification failed")]
    Signature,
    #[error("invalid Merkle proof")]
    MerkleProof,
}

pub type KelResult<T> = Result<T, KelError>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceKind {
    IntentAccepted,
    PlanAccepted,
    AuthorizationDecision,
    ExecutionStarted,
    ExecutionCompleted,
    VerificationCompleted,
    MutationCommitted,
    RollbackCompleted,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EvidenceStatus {
    Pass,
    Fail,
    Blocked,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceContextV1 {
    pub intent_digest: String,
    pub plan_digest: String,
    pub policy_digest: String,
    pub source_tree_digest: String,
    pub runtime_image_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceSubjectV1 {
    pub repository_uri: String,
    pub base_revision: String,
    pub resulting_tree_digest: Option<String>,
    pub change_digest: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceOutcomeV1 {
    pub status: EvidenceStatus,
    pub exit_code: Option<String>,
    pub stdout_digest: Option<String>,
    pub stderr_digest: Option<String>,
    pub started_at_epoch_ms: String,
    pub finished_at_epoch_ms: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactReferenceV1 {
    pub name: String,
    pub media_type: String,
    pub size_bytes: String,
    pub digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceStatementV1 {
    pub schema: String,
    pub ledger_id: String,
    pub evidence_id: String,
    pub run_id: String,
    pub sequence_in_run: String,
    pub kind: EvidenceKind,
    pub producer_id: String,
    pub context: EvidenceContextV1,
    pub subject: EvidenceSubjectV1,
    pub outcome: EvidenceOutcomeV1,
    pub artifacts: Vec<ArtifactReferenceV1>,
    #[serde(default)]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DsseSignatureV1 {
    pub keyid: String,
    pub sig: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DsseEnvelopeV1 {
    pub payload_type: String,
    pub payload: String,
    pub signatures: Vec<DsseSignatureV1>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LedgerLeafV1 {
    pub schema: String,
    pub ledger_id: String,
    /// One-based decimal integer string.
    pub sequence: String,
    pub evidence_id: String,
    pub run_id: String,
    pub kind: EvidenceKind,
    pub envelope_digest: String,
    pub previous_leaf_hash: Option<String>,
    pub accepted_at_epoch_ms: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TreeHeadV1 {
    pub schema: String,
    pub ledger_id: String,
    pub hash_algorithm: String,
    pub tree_algorithm: String,
    /// Number of committed leaves, represented as a decimal string.
    pub tree_size: String,
    pub root_hash: String,
    pub previous_checkpoint_digest: Option<String>,
    pub key_epoch: String,
    pub issued_at_epoch_ms: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InclusionProofV1 {
    pub ledger_id: String,
    pub leaf_index: String,
    pub tree_size: String,
    pub leaf_hash: String,
    pub audit_path: Vec<String>,
    pub tree_head_envelope_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsistencyProofV1 {
    pub ledger_id: String,
    pub old_tree_size: String,
    pub new_tree_size: String,
    pub old_root_hash: String,
    pub new_root_hash: String,
    pub audit_path: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerificationReportV1 {
    pub ledger_integrity: VerificationStatus,
    pub producer_authentication: VerificationStatus,
    pub inclusion: VerificationStatus,
    pub checkpoint_authentication: VerificationStatus,
    pub consistency: VerificationStatus,
    pub witness_quorum: VerificationStatus,
    pub evidence_policy: VerificationStatus,
    pub accepted: bool,
    pub reason_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum VerificationStatus {
    Pass,
    Fail,
    Unknown,
    NotApplicable,
}

/// RFC 8785 canonical JSON bytes. serde_jcs implements the JCS number and
/// property ordering rules; do not substitute serde_json::to_vec here.
pub fn canonicalize<T: Serialize>(value: &T) -> KelResult<Vec<u8>> {
    serde_jcs::to_vec(value).map_err(|e| KelError::Canonicalization(e.to_string()))
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

pub fn digest_hex(data: &[u8]) -> String {
    hex::encode(sha256(data))
}

pub fn digest_json<T: Serialize>(value: &T) -> KelResult<String> {
    Ok(digest_hex(&canonicalize(value)?))
}

fn decode_digest(value: &str) -> KelResult<[u8; 32]> {
    let raw = value.strip_prefix("sha256:").unwrap_or(value);
    let bytes = hex::decode(raw).map_err(|e| KelError::Invalid(format!("invalid SHA-256 digest: {e}")))?;
    bytes.try_into().map_err(|_| KelError::Invalid("SHA-256 digest must be 32 bytes".into()))
}

pub fn validate_digest(value: &str) -> KelResult<()> {
    decode_digest(value).map(|_| ())
}

pub fn validate_evidence(statement: &EvidenceStatementV1) -> KelResult<()> {
    if statement.schema != EVIDENCE_SCHEMA {
        return Err(KelError::Invalid("unsupported evidence schema".into()));
    }
    for (label, value) in [
        ("ledgerId", statement.ledger_id.as_str()),
        ("evidenceId", statement.evidence_id.as_str()),
        ("runId", statement.run_id.as_str()),
        ("producerId", statement.producer_id.as_str()),
        ("sequenceInRun", statement.sequence_in_run.as_str()),
        ("startedAtEpochMs", statement.outcome.started_at_epoch_ms.as_str()),
        ("finishedAtEpochMs", statement.outcome.finished_at_epoch_ms.as_str()),
    ] {
        if value.is_empty() {
            return Err(KelError::Invalid(format!("{label} must not be empty")));
        }
    }
    for digest in [
        statement.context.intent_digest.as_str(),
        statement.context.plan_digest.as_str(),
        statement.context.policy_digest.as_str(),
        statement.context.source_tree_digest.as_str(),
        statement.context.runtime_image_digest.as_str(),
    ] {
        validate_digest(digest)?;
    }
    for digest in [
        statement.subject.resulting_tree_digest.as_deref(),
        statement.subject.change_digest.as_deref(),
        statement.outcome.stdout_digest.as_deref(),
        statement.outcome.stderr_digest.as_deref(),
    ].into_iter().flatten() {
        validate_digest(digest)?;
    }
    for artifact in &statement.artifacts {
        validate_digest(&artifact.digest)?;
        if artifact.name.is_empty() || artifact.media_type.is_empty() || artifact.size_bytes.parse::<u64>().is_err() {
            return Err(KelError::Invalid("invalid artifact reference".into()));
        }
    }
    if statement.sequence_in_run.parse::<u64>().is_err()
        || statement.outcome.started_at_epoch_ms.parse::<u64>().is_err()
        || statement.outcome.finished_at_epoch_ms.parse::<u64>().is_err()
    {
        return Err(KelError::Invalid("sequence and timestamps must be decimal unsigned integers".into()));
    }
    Ok(())
}

/// DSSE v1 pre-authentication encoding; lengths are UTF-8 byte lengths.
pub fn dsse_pae(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let mut out = format!("DSSEv1 {} ", payload_type.as_bytes().len()).into_bytes();
    out.extend_from_slice(payload_type.as_bytes());
    out.extend_from_slice(format!(" {} ", payload.len()).as_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn sign_envelope<T: Serialize>(
    payload_type: &str,
    payload: &T,
    key_id: &str,
    signing_key: &SigningKey,
) -> KelResult<DsseEnvelopeV1> {
    if key_id.is_empty() || payload_type.is_empty() {
        return Err(KelError::Invalid("payload type and key id are required".into()));
    }
    let payload_bytes = canonicalize(payload)?;
    let signature = signing_key.sign(&dsse_pae(payload_type, &payload_bytes));
    Ok(DsseEnvelopeV1 {
        payload_type: payload_type.to_owned(),
        payload: BASE64.encode(payload_bytes),
        signatures: vec![DsseSignatureV1 {
            keyid: key_id.to_owned(),
            sig: BASE64.encode(signature.to_bytes()),
        }],
    })
}

/// Validates canonical payload bytes and at least one trusted DSSE signature.
pub fn verify_envelope<T: Serialize + DeserializeOwned>(
    envelope: &DsseEnvelopeV1,
    expected_payload_type: &str,
    trusted_keys: &BTreeMap<String, VerifyingKey>,
) -> KelResult<T> {
    if envelope.payload_type != expected_payload_type || envelope.signatures.is_empty() {
        return Err(KelError::Invalid("DSSE payload type or signatures are invalid".into()));
    }
    let payload_bytes = BASE64.decode(&envelope.payload)?;
    let value: T = serde_json::from_slice(&payload_bytes)?;
    if canonicalize(&value)? != payload_bytes {
        return Err(KelError::Invalid("DSSE payload is not RFC 8785 canonical JSON".into()));
    }
    let pae = dsse_pae(&envelope.payload_type, &payload_bytes);
    let mut valid = false;
    for signature in &envelope.signatures {
        if let Some(key) = trusted_keys.get(&signature.keyid) {
            let signature_bytes = BASE64.decode(&signature.sig)?;
            let signature = Signature::from_slice(&signature_bytes)
                .map_err(|_| KelError::Invalid("Ed25519 signature must be 64 bytes".into()))?;
            if key.verify(&pae, &signature).is_ok() {
                valid = true;
                break;
            }
        }
    }
    if !valid {
        return Err(KelError::Signature);
    }
    Ok(value)
}

pub fn envelope_digest(envelope: &DsseEnvelopeV1) -> KelResult<String> {
    digest_json(envelope)
}

/// RFC 9162 leaf hash: SHA-256(0x00 || canonical_leaf_bytes).
pub fn leaf_hash(leaf_bytes: &[u8]) -> [u8; 32] {
    let mut input = Vec::with_capacity(1 + leaf_bytes.len());
    input.push(0x00);
    input.extend_from_slice(leaf_bytes);
    sha256(&input)
}

/// RFC 9162 interior hash: SHA-256(0x01 || left_hash || right_hash).
pub fn node_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut input = [0u8; 65];
    input[0] = 0x01;
    input[1..33].copy_from_slice(left);
    input[33..65].copy_from_slice(right);
    sha256(&input)
}

fn split_point(n: usize) -> usize {
    debug_assert!(n > 1);
    let mut k = 1usize;
    while k < n {
        k <<= 1;
    }
    k >> 1
}

pub fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    match leaves.len() {
        0 => sha256(&[]),
        1 => leaves[0],
        n => {
            let k = split_point(n);
            node_hash(&merkle_root(&leaves[..k]), &merkle_root(&leaves[k..]))
        }
    }
}

fn build_inclusion_path(index: usize, leaves: &[[u8; 32]], path: &mut Vec<[u8; 32]>) {
    if leaves.len() <= 1 {
        return;
    }
    let k = split_point(leaves.len());
    if index < k {
        build_inclusion_path(index, &leaves[..k], path);
        path.push(merkle_root(&leaves[k..]));
    } else {
        build_inclusion_path(index - k, &leaves[k..], path);
        path.push(merkle_root(&leaves[..k]));
    }
}

pub fn inclusion_proof(leaves: &[[u8; 32]], index: usize) -> KelResult<Vec<[u8; 32]>> {
    if index >= leaves.len() {
        return Err(KelError::Invalid("leaf index is outside the tree".into()));
    }
    let mut path = Vec::new();
    build_inclusion_path(index, leaves, &mut path);
    Ok(path)
}

fn verify_inclusion_recursive(
    index: usize,
    size: usize,
    leaf: [u8; 32],
    path: &[[u8; 32]],
    cursor: &mut usize,
) -> KelResult<[u8; 32]> {
    if size == 1 {
        return Ok(leaf);
    }
    let k = split_point(size);
    if index < k {
        let left = verify_inclusion_recursive(index, k, leaf, path, cursor)?;
        let right = *path.get(*cursor).ok_or(KelError::MerkleProof)?;
        *cursor += 1;
        Ok(node_hash(&left, &right))
    } else {
        let right = verify_inclusion_recursive(index - k, size - k, leaf, path, cursor)?;
        let left = *path.get(*cursor).ok_or(KelError::MerkleProof)?;
        *cursor += 1;
        Ok(node_hash(&left, &right))
    }
}

pub fn verify_inclusion(
    leaf: [u8; 32],
    index: usize,
    tree_size: usize,
    proof: &[[u8; 32]],
    expected_root: [u8; 32],
) -> bool {
    if tree_size == 0 || index >= tree_size {
        return false;
    }
    let mut cursor = 0;
    match verify_inclusion_recursive(index, tree_size, leaf, proof, &mut cursor) {
        Ok(root) => cursor == proof.len() && root == expected_root,
        Err(_) => false,
    }
}

fn build_consistency_subproof(
    old_size: usize,
    leaves: &[[u8; 32]],
    complete_subtree: bool,
    proof: &mut Vec<[u8; 32]>,
) {
    let n = leaves.len();
    if old_size == n {
        if !complete_subtree {
            proof.push(merkle_root(leaves));
        }
        return;
    }
    let k = split_point(n);
    if old_size <= k {
        build_consistency_subproof(old_size, &leaves[..k], complete_subtree, proof);
        proof.push(merkle_root(&leaves[k..]));
    } else {
        build_consistency_subproof(old_size - k, &leaves[k..], false, proof);
        proof.push(merkle_root(&leaves[..k]));
    }
}

pub fn consistency_proof(leaves: &[[u8; 32]], old_size: usize) -> KelResult<Vec<[u8; 32]>> {
    if old_size > leaves.len() {
        return Err(KelError::Invalid("old tree size exceeds new tree size".into()));
    }
    if old_size == 0 || old_size == leaves.len() {
        return Ok(Vec::new());
    }
    let mut proof = Vec::new();
    build_consistency_subproof(old_size, leaves, true, &mut proof);
    Ok(proof)
}

/// RFC 9162 consistency proof verifier (proof hashes are raw 32-byte values).
pub fn verify_consistency(
    old_size: usize,
    new_size: usize,
    old_root: [u8; 32],
    new_root: [u8; 32],
    proof: &[[u8; 32]],
) -> bool {
    if old_size == 0 {
        return true;
    }
    if old_size > new_size {
        return false;
    }
    if old_size == new_size {
        return proof.is_empty() && old_root == new_root;
    }
    if proof.is_empty() {
        return false;
    }

    let mut fn_index = old_size - 1;
    let mut sn_index = new_size - 1;
    while fn_index & 1 == 1 {
        fn_index >>= 1;
        sn_index >>= 1;
    }

    let (mut first_root, mut second_root, mut proof_index) = if fn_index == 0 {
        (old_root, old_root, 0usize)
    } else {
        (proof[0], proof[0], 1usize)
    };

    while proof_index < proof.len() {
        let item = proof[proof_index];
        if fn_index & 1 == 1 || fn_index == sn_index {
            first_root = node_hash(&item, &first_root);
            second_root = node_hash(&item, &second_root);
            while fn_index != 0 && fn_index & 1 == 0 {
                fn_index >>= 1;
                sn_index >>= 1;
            }
        } else {
            second_root = node_hash(&second_root, &item);
        }
        fn_index >>= 1;
        sn_index >>= 1;
        proof_index += 1;
    }
    first_root == old_root && second_root == new_root
}

pub fn hex_hash(hash: &[u8; 32]) -> String {
    hex::encode(hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_statement() -> EvidenceStatementV1 {
        let d = format!("sha256:{}", "11".repeat(32));
        EvidenceStatementV1 {
            schema: EVIDENCE_SCHEMA.into(),
            ledger_id: "ledger-1".into(),
            evidence_id: "evidence-1".into(),
            run_id: "run-1".into(),
            sequence_in_run: "1".into(),
            kind: EvidenceKind::ExecutionCompleted,
            producer_id: "runtime-1".into(),
            context: EvidenceContextV1 {
                intent_digest: d.clone(), plan_digest: d.clone(), policy_digest: d.clone(),
                source_tree_digest: d.clone(), runtime_image_digest: d.clone(),
            },
            subject: EvidenceSubjectV1 {
                repository_uri: "https://example.invalid/repo".into(),
                base_revision: "abc123".into(), resulting_tree_digest: Some(d.clone()),
                change_digest: None,
            },
            outcome: EvidenceOutcomeV1 {
                status: EvidenceStatus::Pass, exit_code: Some("0".into()),
                stdout_digest: None, stderr_digest: None,
                started_at_epoch_ms: "1".into(), finished_at_epoch_ms: "2".into(),
            },
            artifacts: vec![],
            extensions: BTreeMap::new(),
        }
    }

    #[test]
    fn jcs_sorts_keys_and_uses_rfc8785_number_serialization() {
        assert_eq!(canonicalize(&json!({"z": 1, "a": 2})).unwrap(), br#"{"a":2,"z":1}"#);
        assert_eq!(canonicalize(&json!({"n": 1e-7})).unwrap(), br#"{"n":1e-7}"#);
    }

    #[test]
    fn dsse_signature_binds_type_and_canonical_payload() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let verify = signing.verifying_key();
        let statement = sample_statement();
        let envelope = sign_envelope(EVIDENCE_PAYLOAD_TYPE, &statement, "test-key", &signing).unwrap();
        let keys = BTreeMap::from([("test-key".to_string(), verify)]);
        let decoded: EvidenceStatementV1 = verify_envelope(&envelope, EVIDENCE_PAYLOAD_TYPE, &keys).unwrap();
        assert_eq!(decoded, statement);
        assert!(verify_envelope::<EvidenceStatementV1>(&envelope, "wrong/type", &keys).is_err());
    }

    #[test]
    fn inclusion_proofs_cover_non_power_of_two_sizes() {
        for size in 1..20 {
            let leaves: Vec<[u8; 32]> = (0..size).map(|i| leaf_hash(i.to_string().as_bytes())).collect();
            let root = merkle_root(&leaves);
            for index in 0..size {
                let proof = inclusion_proof(&leaves, index).unwrap();
                assert!(verify_inclusion(leaves[index], index, size, &proof, root), "size={size}, index={index}");
            }
        }
    }

    #[test]
    fn consistency_proofs_cover_all_prefixes() {
        for new_size in 2..25 {
            let leaves: Vec<[u8; 32]> = (0..new_size).map(|i| leaf_hash(i.to_string().as_bytes())).collect();
            for old_size in 1..new_size {
                let proof = consistency_proof(&leaves, old_size).unwrap();
                assert!(
                    verify_consistency(old_size, new_size, merkle_root(&leaves[..old_size]), merkle_root(&leaves), &proof),
                    "old={old_size}, new={new_size}, proof={}",
                    proof.len()
                );
            }
        }
    }

    #[test]
    fn evidence_rejects_bad_digest_and_wrong_schema() {
        let mut statement = sample_statement();
        assert!(validate_evidence(&statement).is_ok());
        statement.context.plan_digest = "sha256:broken".into();
        assert!(validate_evidence(&statement).is_err());
    }
}
