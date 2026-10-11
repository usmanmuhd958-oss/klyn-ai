//! Durable SQLite WAL storage for KEL v1.
//!
//! The daemon owns persistence and key use. Private keys must be supplied by a
//! trusted key provider/HSM in production; never load them from agent-controlled input.

pub mod key_custody;
pub mod rpc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Signer as DalekSigner, SigningKey, Verifier, VerifyingKey};
use key_custody::{CheckpointSigner, SigningProviderError};
use klyn_evidence::{
    canonicalize, digest_json, dsse_pae, envelope_digest, leaf_hash, merkle_root, node_hash,
    validate_evidence, verify_envelope, DsseEnvelopeV1, DsseSignatureV1, EvidenceStatementV1, LedgerLeafV1,
    InclusionProofV1, TreeHeadV1, EVIDENCE_PAYLOAD_TYPE, TREE_HEAD_PAYLOAD_TYPE,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, path::Path, sync::Arc};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("evidence protocol error: {0}")]
    Protocol(#[from] klyn_evidence::KelError),
    #[error("idempotency conflict for evidence id {0}")]
    IdempotencyConflict(String),
    #[error("ledger id does not match configured ledger")]
    LedgerMismatch,
    #[error("ledger invariant failed: {0}")]
    Invariant(String),
    #[error("JSON encoding error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("hex decoding error: {0}")]
    Hex(#[from] hex::FromHexError),
}

pub type Result<T> = std::result::Result<T, LedgerError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendReceiptV1 {
    pub ledger_id: String,
    pub sequence: String,
    pub evidence_id: String,
    pub envelope_digest: String,
    pub leaf_hash: String,
    pub tree_size: String,
    pub root_hash: String,
    pub checkpoint_envelope: DsseEnvelopeV1,
    pub idempotent_replay: bool,
}


#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceProofBundleV1 {
    pub evidence_id: String,
    pub leaf: LedgerLeafV1,
    pub evidence_envelope: DsseEnvelopeV1,
    pub proof: InclusionProofV1,
    pub checkpoint_envelope: DsseEnvelopeV1,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerHealthV1 {
    pub ledger_id: String,
    pub tree_size: String,
    pub root_hash: String,
}

struct LocalEd25519Signer {
    key_id: String,
    epoch: String,
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}
impl CheckpointSigner for LocalEd25519Signer {
    fn key_id(&self) -> &str { &self.key_id }
    fn key_epoch(&self) -> &str { &self.epoch }
    fn verifying_key(&self) -> &VerifyingKey { &self.verifying_key }
    fn sign_pae(&self, pre_auth_encoding: &[u8]) -> std::result::Result<[u8; 64], SigningProviderError> {
        Ok(self.signing_key.sign(pre_auth_encoding).to_bytes())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WitnessKeyConfigV1 {
    pub key_id: String,
    pub witness_id: String,
    pub key_epoch: String,
    pub public_key_hex: String,
    pub not_before_epoch_ms: String,
    pub not_after_epoch_ms: String,
    #[serde(default)]
    pub revoked_at_epoch_ms: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WitnessSignatureV1 {
    pub witness_id: String,
    pub key_id: String,
    pub key_epoch: String,
    pub signature_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WitnessQuorumStatusV1 {
    pub checkpoint_digest: String,
    pub ledger_id: String,
    pub tree_size: String,
    pub root_hash: String,
    pub threshold: u8,
    pub valid_witness_count: u32,
    pub valid_witness_ids: Vec<String>,
    pub accepted: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WitnessStatementV1 {
    schema: &'static str,
    witness_id: String,
    ledger_id: String,
    tree_size: String,
    root_hash: String,
    tree_head_digest: String,
    checkpoint_key_epoch: String,
    issued_at_epoch_ms: String,
}

pub struct EvidenceStore {
    connection: Connection,
    ledger_id: String,
    checkpoint_key_id: String,
    checkpoint_key_epoch: String,
    checkpoint_signer: Arc<dyn CheckpointSigner>,
    producer_keys: BTreeMap<String, VerifyingKey>,
}

impl EvidenceStore {
    /// Compatibility constructor for tests and local development. Production startup
    /// must call open_with_signer with an external HSM/KMS-backed signer.
    pub fn open(
        path: impl AsRef<Path>,
        ledger_id: impl Into<String>,
        checkpoint_key_id: impl Into<String>,
        checkpoint_key_epoch: impl Into<String>,
        checkpoint_signing_key: SigningKey,
        producer_keys: BTreeMap<String, VerifyingKey>,
    ) -> Result<Self> {
        let verifying_key = checkpoint_signing_key.verifying_key();
        let signer = Arc::new(LocalEd25519Signer {
            key_id: checkpoint_key_id.into(),
            epoch: checkpoint_key_epoch.into(),
            signing_key: checkpoint_signing_key,
            verifying_key,
        });
        Self::open_with_signer(path, ledger_id, signer, producer_keys)
    }

    /// Open the ledger with an abstract signing provider. The daemon never receives
    /// private-key bytes when using ExternalSignerClient.
    pub fn open_with_signer(
        path: impl AsRef<Path>,
        ledger_id: impl Into<String>,
        checkpoint_signer: Arc<dyn CheckpointSigner>,
        producer_keys: BTreeMap<String, VerifyingKey>,
    ) -> Result<Self> {
        let ledger_id = ledger_id.into();
        let checkpoint_key_epoch = checkpoint_signer.key_epoch().to_owned();
        if ledger_id.trim().is_empty() {
            return Err(LedgerError::Invariant("ledger id is required".into()));
        }
        if checkpoint_signer.key_id().trim().is_empty() ||
            checkpoint_key_epoch.parse::<u64>().is_err() {
            return Err(LedgerError::Invariant("checkpoint signer key id/epoch is invalid".into()));
        }
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS ledger_meta (
                ledger_id TEXT PRIMARY KEY,
                tree_size INTEGER NOT NULL CHECK(tree_size >= 0),
                root_hash TEXT NOT NULL CHECK(length(root_hash) = 64),
                previous_leaf_hash TEXT,
                previous_checkpoint_digest TEXT,
                key_epoch TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS evidence_blobs (
                evidence_id TEXT PRIMARY KEY,
                envelope_digest TEXT NOT NULL UNIQUE CHECK(length(envelope_digest) = 71),
                envelope_json TEXT NOT NULL,
                payload_json TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS ledger_leaves (
                sequence INTEGER PRIMARY KEY CHECK(sequence >= 1),
                ledger_id TEXT NOT NULL,
                evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence_blobs(evidence_id),
                leaf_json TEXT NOT NULL,
                leaf_hash TEXT NOT NULL CHECK(length(leaf_hash) = 64),
                previous_leaf_hash TEXT
             ) STRICT;
             CREATE TABLE IF NOT EXISTS merkle_nodes (
                level INTEGER NOT NULL CHECK(level >= 0),
                node_index INTEGER NOT NULL CHECK(node_index >= 0),
                hash TEXT NOT NULL CHECK(length(hash) = 64),
                PRIMARY KEY(level, node_index)
             ) STRICT;
             CREATE TABLE IF NOT EXISTS signed_tree_heads (
                tree_size INTEGER PRIMARY KEY CHECK(tree_size >= 0),
                root_hash TEXT NOT NULL CHECK(length(root_hash) = 64),
                checkpoint_digest TEXT NOT NULL UNIQUE CHECK(length(checkpoint_digest) = 71),
                envelope_json TEXT NOT NULL,
                issued_at_epoch_ms TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS witness_keys (
                key_id TEXT PRIMARY KEY,
                witness_id TEXT NOT NULL,
                key_epoch TEXT NOT NULL,
                public_key_hex TEXT NOT NULL CHECK(length(public_key_hex) = 64),
                not_before_epoch_ms TEXT NOT NULL,
                not_after_epoch_ms TEXT NOT NULL,
                revoked_at_epoch_ms TEXT,
                UNIQUE(witness_id, key_epoch)
             ) STRICT;
             CREATE TABLE IF NOT EXISTS witness_checkpoint_quorums (
                checkpoint_digest TEXT PRIMARY KEY,
                ledger_id TEXT NOT NULL,
                tree_size INTEGER NOT NULL CHECK(tree_size >= 0),
                root_hash TEXT NOT NULL CHECK(length(root_hash) = 71),
                threshold INTEGER NOT NULL CHECK(threshold IN (2,3)),
                status TEXT NOT NULL CHECK(status IN ('collecting', 'quorum_met')),
                created_at_epoch_ms TEXT NOT NULL
             ) STRICT;
             CREATE TABLE IF NOT EXISTS witness_receipts (
                checkpoint_digest TEXT NOT NULL REFERENCES witness_checkpoint_quorums(checkpoint_digest),
                witness_id TEXT NOT NULL,
                key_id TEXT NOT NULL REFERENCES witness_keys(key_id),
                key_epoch TEXT NOT NULL,
                statement_json TEXT NOT NULL,
                signature_base64 TEXT NOT NULL,
                received_at_epoch_ms TEXT NOT NULL,
                PRIMARY KEY(checkpoint_digest, witness_id)
             ) STRICT;
             CREATE TRIGGER IF NOT EXISTS witness_receipts_no_update
             BEFORE UPDATE ON witness_receipts BEGIN
                SELECT RAISE(ABORT, 'witness receipts are append-only');
             END;
             CREATE TRIGGER IF NOT EXISTS witness_receipts_no_delete
             BEFORE DELETE ON witness_receipts BEGIN
                SELECT RAISE(ABORT, 'witness receipts are append-only');
             END;
             CREATE TRIGGER IF NOT EXISTS witness_checkpoint_quorums_immutable_binding
             BEFORE UPDATE OF checkpoint_digest, ledger_id, tree_size, root_hash, threshold, created_at_epoch_ms ON witness_checkpoint_quorums BEGIN
                SELECT RAISE(ABORT, 'witness quorum checkpoint binding is immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS ledger_leaves_no_update
             BEFORE UPDATE ON ledger_leaves BEGIN
                SELECT RAISE(ABORT, 'KEL leaves are append-only');
             END;
             CREATE TRIGGER IF NOT EXISTS ledger_leaves_no_delete
             BEFORE DELETE ON ledger_leaves BEGIN
                SELECT RAISE(ABORT, 'KEL leaves are append-only');
             END;
             CREATE TRIGGER IF NOT EXISTS evidence_blobs_no_update
             BEFORE UPDATE ON evidence_blobs BEGIN
                SELECT RAISE(ABORT, 'KEL evidence blobs are immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS evidence_blobs_no_delete
             BEFORE DELETE ON evidence_blobs BEGIN
                SELECT RAISE(ABORT, 'KEL evidence blobs are immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS merkle_nodes_no_update
             BEFORE UPDATE ON merkle_nodes BEGIN
                SELECT RAISE(ABORT, 'KEL Merkle nodes are immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS merkle_nodes_no_delete
             BEFORE DELETE ON merkle_nodes BEGIN
                SELECT RAISE(ABORT, 'KEL Merkle nodes are immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS signed_tree_heads_no_update
             BEFORE UPDATE ON signed_tree_heads BEGIN
                SELECT RAISE(ABORT, 'KEL tree heads are immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS signed_tree_heads_no_delete
             BEFORE DELETE ON signed_tree_heads BEGIN
                SELECT RAISE(ABORT, 'KEL tree heads are immutable');
             END;"
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO ledger_meta
             (ledger_id, tree_size, root_hash, previous_leaf_hash, previous_checkpoint_digest, key_epoch)
             VALUES (?1, 0, ?2, NULL, NULL, ?3)",
            params![ledger_id, hex::encode(Sha256::digest(b"")), checkpoint_key_epoch],
        )?;
        let store = Self {
            connection,
            ledger_id,
            checkpoint_key_id: checkpoint_signer.key_id().to_owned(),
            checkpoint_key_epoch,
            checkpoint_signer,
            producer_keys,
        };
        store.verify_meta()?;
        Ok(store)
    }

    fn verify_meta(&self) -> Result<()> {
        let row: (String, i64, String) = self.connection.query_row(
            "SELECT ledger_id, tree_size, root_hash FROM ledger_meta WHERE ledger_id=?1",
            params![self.ledger_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        if row.0 != self.ledger_id {
            return Err(LedgerError::LedgerMismatch);
        }
        if row.1 < 0 {
            return Err(LedgerError::Invariant("negative tree size".into()));
        }
        let leaves = self.load_leaf_hashes()?;
        let computed = hex::encode(merkle_root(&leaves));
        if computed != row.2 || leaves.len() as i64 != row.1 {
            return Err(LedgerError::Invariant("persisted Merkle root or size mismatch".into()));
        }
        Ok(())
    }

    fn load_leaf_hashes(&self) -> Result<Vec<[u8; 32]>> {
        let mut statement = self.connection.prepare("SELECT leaf_hash FROM ledger_leaves ORDER BY sequence")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut hashes = Vec::new();
        for row in rows {
            let bytes = hex::decode(row?)?;
            hashes.push(bytes.try_into().map_err(|_| LedgerError::Invariant("invalid stored leaf hash".into()))?);
        }
        Ok(hashes)
    }

    pub fn append(
        &mut self,
        envelope: &DsseEnvelopeV1,
        accepted_at_epoch_ms: u64,
        now_epoch_ms: u64,
    ) -> Result<AppendReceiptV1> {
        // Validate schema, canonical bytes and trusted producer signature before opening
        // the write transaction. No malformed evidence can partially mutate storage.
        let statement: EvidenceStatementV1 =
            verify_envelope(envelope, EVIDENCE_PAYLOAD_TYPE, &self.producer_keys)?;
        validate_evidence(&statement)?;
        if statement.ledger_id != self.ledger_id {
            return Err(LedgerError::LedgerMismatch);
        }
        let payload_json = String::from_utf8(klyn_evidence::canonicalize(&statement)?)
            .map_err(|e| LedgerError::Invariant(e.to_string()))?;
        let envelope_digest = envelope_digest(envelope)?;
        let envelope_json = serde_json::to_string(envelope)?;

        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some((existing_digest, sequence, leaf_hash_value, tree_size, root_hash, checkpoint_json)) = tx
            .query_row(
                "SELECT b.envelope_digest, l.sequence, l.leaf_hash, h.tree_size, h.root_hash, h.envelope_json
                 FROM evidence_blobs b JOIN ledger_leaves l ON l.evidence_id=b.evidence_id
                 JOIN signed_tree_heads h ON h.tree_size=l.sequence WHERE b.evidence_id=?1",
                params![statement.evidence_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?, r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?)),
            ).optional()? {
            if existing_digest != envelope_digest {
                return Err(LedgerError::IdempotencyConflict(statement.evidence_id));
            }
            let checkpoint_json = checkpoint_json.ok_or_else(|| LedgerError::Invariant("checkpoint missing".into()))?;
            let checkpoint_envelope = serde_json::from_str(&checkpoint_json)?;
            tx.commit()?;
            return Ok(AppendReceiptV1 {
                ledger_id: self.ledger_id.clone(), sequence: sequence.to_string(),
                evidence_id: statement.evidence_id, envelope_digest, leaf_hash: format!("sha256:{leaf_hash_value}"),
                tree_size: tree_size.to_string(), root_hash: format!("sha256:{root_hash}"), checkpoint_envelope, idempotent_replay: true,
            });
        }

        let (tree_size, previous_leaf_hash, previous_checkpoint_digest): (i64, Option<String>, Option<String>) =
            tx.query_row(
                "SELECT tree_size, previous_leaf_hash, previous_checkpoint_digest FROM ledger_meta WHERE ledger_id=?1",
                params![self.ledger_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
        let sequence = tree_size + 1;
        let leaf = LedgerLeafV1 {
            schema: klyn_evidence::LEAF_SCHEMA.into(),
            ledger_id: self.ledger_id.clone(),
            sequence: sequence.to_string(),
            evidence_id: statement.evidence_id.clone(),
            run_id: statement.run_id.clone(),
            kind: statement.kind.clone(),
            envelope_digest: envelope_digest.clone(),
            previous_leaf_hash: previous_leaf_hash.clone().map(|hash| format!("sha256:{hash}")),
            accepted_at_epoch_ms: accepted_at_epoch_ms.to_string(),
        };
        let leaf_bytes = canonicalize(&leaf)?;
        let leaf_hash_bytes = leaf_hash(&leaf_bytes);
        let leaf_hash_hex = hex::encode(leaf_hash_bytes);
        let new_size = sequence as usize;

        tx.execute(
            "INSERT INTO evidence_blobs(evidence_id,envelope_digest,envelope_json,payload_json) VALUES(?1,?2,?3,?4)",
            params![statement.evidence_id, envelope_digest, envelope_json, payload_json],
        )?;
        tx.execute(
            "INSERT INTO ledger_leaves(sequence,ledger_id,evidence_id,leaf_json,leaf_hash,previous_leaf_hash)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![sequence, self.ledger_id, statement.evidence_id, String::from_utf8(leaf_bytes).unwrap(), leaf_hash_hex, previous_leaf_hash],
        )?;
        tx.execute(
            "INSERT INTO merkle_nodes(level,node_index,hash) VALUES(0,?1,?2)",
            params![sequence - 1, hex::encode(leaf_hash_bytes)],
        )?;
        let mut level = 0i64;
        let mut node_index = sequence - 1;
        let mut current_hash = leaf_hash_bytes;
        while node_index & 1 == 1 {
            let left_index = node_index - 1;
            let left_hex: String = tx.query_row(
                "SELECT hash FROM merkle_nodes WHERE level=?1 AND node_index=?2",
                params![level, left_index],
                |r| r.get(0),
            )?;
            let left: [u8; 32] = hex::decode(left_hex)?.try_into()
                .map_err(|_| LedgerError::Invariant("invalid stored Merkle node".into()))?;
            current_hash = klyn_evidence::node_hash(&left, &current_hash);
            level += 1;
            node_index >>= 1;
            tx.execute(
                "INSERT INTO merkle_nodes(level,node_index,hash) VALUES(?1,?2,?3)",
                params![level, node_index, hex::encode(current_hash)],
            )?;
        }

        let root_hash = root_from_frontier(&tx, sequence)?;
        let tree_head = TreeHeadV1 {
            schema: klyn_evidence::TREE_HEAD_SCHEMA.into(),
            ledger_id: self.ledger_id.clone(),
            hash_algorithm: klyn_evidence::HASH_ALGORITHM.into(),
            tree_algorithm: klyn_evidence::TREE_ALGORITHM.into(),
            tree_size: new_size.to_string(),
            root_hash: format!("sha256:{root_hash}"),
            previous_checkpoint_digest,
            key_epoch: self.checkpoint_key_epoch.clone(),
            issued_at_epoch_ms: now_epoch_ms.to_string(),
        };
        let checkpoint_payload = canonicalize(&tree_head)?;
        let pae = dsse_pae(TREE_HEAD_PAYLOAD_TYPE, &checkpoint_payload);
        let signature = self.checkpoint_signer.sign_pae(&pae)
            .map_err(|error| LedgerError::Invariant(format!("checkpoint signing failed: {error}")))?;
        // Verify provider output locally; a misconfigured or compromised adapter cannot
        // cause an unverifiable checkpoint to be committed.
        self.checkpoint_signer.verifying_key().verify(
            &pae, &Signature::from_bytes(&signature)
        ).map_err(|_| LedgerError::Invariant("checkpoint signer returned an invalid signature".into()))?;
        let checkpoint_envelope = DsseEnvelopeV1 {
            payload_type: TREE_HEAD_PAYLOAD_TYPE.to_owned(),
            payload: BASE64.encode(&checkpoint_payload),
            signatures: vec![DsseSignatureV1 {
                keyid: self.checkpoint_key_id.clone(),
                sig: BASE64.encode(signature),
            }],
        };
        let checkpoint_digest = digest_json(&checkpoint_envelope)?;
        tx.execute(
            "INSERT INTO signed_tree_heads(tree_size,root_hash,checkpoint_digest,envelope_json,issued_at_epoch_ms)
             VALUES(?1,?2,?3,?4,?5)",
            params![sequence, root_hash, checkpoint_digest, serde_json::to_string(&checkpoint_envelope)?, now_epoch_ms.to_string()],
        )?;
        tx.execute(
            "UPDATE ledger_meta SET tree_size=?1, root_hash=?2, previous_leaf_hash=?3,
             previous_checkpoint_digest=?4, key_epoch=?5 WHERE ledger_id=?6",
            params![sequence, root_hash, leaf_hash_hex, checkpoint_digest, self.checkpoint_key_epoch, self.ledger_id],
        )?;
        // Test-only failpoint: abrupt process death while the write transaction is open.
        // Compiled out of release builds; used to prove WAL rollback/recovery.
        #[cfg(debug_assertions)]
        if std::env::var_os("KEL_TEST_CRASH_BEFORE_COMMIT").is_some() {
            std::process::abort();
        }
        tx.commit()?;

        Ok(AppendReceiptV1 {
            ledger_id: self.ledger_id.clone(),
            sequence: sequence.to_string(),
            evidence_id: statement.evidence_id,
            envelope_digest,
            leaf_hash: format!("sha256:{leaf_hash_hex}"),
            tree_size: sequence.to_string(),
            root_hash: format!("sha256:{root_hash}"),
            checkpoint_envelope,
            idempotent_replay: false,
        })
    }

    pub fn latest_tree_head(&self) -> Result<Option<DsseEnvelopeV1>> {
        let raw: Option<String> = self.connection.query_row(
            "SELECT envelope_json FROM signed_tree_heads ORDER BY tree_size DESC LIMIT 1",
            [],
            |r| r.get(0),
        ).optional()?;
        raw.map(|v| serde_json::from_str(&v).map_err(LedgerError::from)).transpose()
    }

    pub fn leaf_count(&self) -> Result<u64> {
        let size: i64 = self.connection.query_row(
            "SELECT tree_size FROM ledger_meta WHERE ledger_id=?1", params![self.ledger_id], |r| r.get(0)
        )?;
        Ok(size as u64)
    }

    /// Configure a witness verification key. Key IDs and (witness, epoch) pairs are never reused.
    /// Public keys are immutable; revocation can only transition from absent to a timestamp.
    pub fn configure_witness_key(&mut self, config: &WitnessKeyConfigV1) -> Result<()> {
        if config.key_id.trim().is_empty() || config.witness_id.trim().is_empty() ||
            config.key_epoch.parse::<u64>().is_err() ||
            config.not_before_epoch_ms.parse::<u64>().is_err() ||
            config.not_after_epoch_ms.parse::<u64>().is_err() ||
            config.not_before_epoch_ms.parse::<u64>().unwrap() >= config.not_after_epoch_ms.parse::<u64>().unwrap() {
            return Err(LedgerError::Invariant("invalid witness key metadata".into()));
        }
        if let Some(revoked) = &config.revoked_at_epoch_ms {
            if revoked.parse::<u64>().is_err() {
                return Err(LedgerError::Invariant("invalid witness key revocation timestamp".into()));
            }
        }
        if config.public_key_hex.len() != 64 || !config.public_key_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(LedgerError::Invariant("witness public key must be 32 bytes of hex".into()));
        }
        let public_bytes: [u8; 32] = hex::decode(&config.public_key_hex)?.try_into()
            .map_err(|_| LedgerError::Invariant("witness public key must be 32 bytes".into()))?;
        VerifyingKey::from_bytes(&public_bytes)
            .map_err(|_| LedgerError::Invariant("invalid Ed25519 witness public key".into()))?;

        let existing: Option<(String, String, String, String, String, Option<String>)> = self.connection.query_row(
            "SELECT witness_id, key_epoch, public_key_hex, not_before_epoch_ms, not_after_epoch_ms, revoked_at_epoch_ms
             FROM witness_keys WHERE key_id=?1",
            params![config.key_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).optional()?;
        if let Some((witness_id, epoch, public_key, not_before, not_after, revoked)) = existing {
            if witness_id != config.witness_id || epoch != config.key_epoch ||
                public_key != config.public_key_hex.to_ascii_lowercase() ||
                not_before != config.not_before_epoch_ms || not_after != config.not_after_epoch_ms {
                return Err(LedgerError::Invariant("witness key IDs are immutable and cannot be reused".into()));
            }
            if let Some(new_revoked) = &config.revoked_at_epoch_ms {
                if revoked.as_deref().is_some_and(|prior| prior != new_revoked) {
                    return Err(LedgerError::Invariant("witness key was already revoked at another time".into()));
                }
                self.connection.execute(
                    "UPDATE witness_keys SET revoked_at_epoch_ms=?1 WHERE key_id=?2 AND revoked_at_epoch_ms IS NULL",
                    params![new_revoked, config.key_id],
                )?;
            }
            return Ok(());
        }

        // New key epochs must be monotonically increasing for every witness identity.
        let existing_epochs: Vec<String> = {
            let mut statement = self.connection.prepare(
                "SELECT key_epoch FROM witness_keys WHERE witness_id=?1",
            )?;
            let rows = statement.query_map(params![config.witness_id], |row| row.get::<_, String>(0))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let new_epoch = config.key_epoch.parse::<u64>().map_err(|_| {
            LedgerError::Invariant("invalid witness epoch".into())
        })?;
        for epoch in existing_epochs {
            if epoch.parse::<u64>().unwrap_or(u64::MAX) >= new_epoch {
                return Err(LedgerError::Invariant("witness key epochs must increase monotonically".into()));
            }
        }
        if let Some(revoked) = &config.revoked_at_epoch_ms {
            if revoked.parse::<u64>().unwrap() < config.not_before_epoch_ms.parse::<u64>().unwrap() {
                return Err(LedgerError::Invariant("revocation cannot precede key validity".into()));
            }
        }

        self.connection.execute(
            "INSERT INTO witness_keys(key_id,witness_id,key_epoch,public_key_hex,not_before_epoch_ms,not_after_epoch_ms,revoked_at_epoch_ms)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                config.key_id, config.witness_id, config.key_epoch,
                config.public_key_hex.to_ascii_lowercase(), config.not_before_epoch_ms,
                config.not_after_epoch_ms, config.revoked_at_epoch_ms
            ],
        )?;
        Ok(())
    }

    /// Verify and durably store independently signed witness receipts. A partial valid set
    /// is persisted as collecting; accepted is true only once the configured threshold is met.
    pub fn submit_witness_receipts(
        &mut self,
        checkpoint_envelope: &DsseEnvelopeV1,
        signatures: &[WitnessSignatureV1],
        threshold: u8,
        now_epoch_ms: u64,
    ) -> Result<WitnessQuorumStatusV1> {
        if !(2..=3).contains(&threshold) {
            return Err(LedgerError::Invariant("witness threshold must be 2 or 3".into()));
        }
        let checkpoint_keys = BTreeMap::from([(
            self.checkpoint_signer.key_id().to_owned(),
            *self.checkpoint_signer.verifying_key(),
        )]);
        let tree_head: TreeHeadV1 =
            verify_envelope(checkpoint_envelope, TREE_HEAD_PAYLOAD_TYPE, &checkpoint_keys)?;
        if tree_head.ledger_id != self.ledger_id ||
            tree_head.key_epoch != self.checkpoint_signer.key_epoch() ||
            tree_head.tree_size.parse::<u64>().is_err() ||
            tree_head.issued_at_epoch_ms.parse::<u64>().is_err() {
            return Err(LedgerError::Invariant("checkpoint metadata does not match active ledger key".into()));
        }
        let checkpoint_digest = digest_json(checkpoint_envelope)?;
        let stored: Option<(i64, String)> = self.connection.query_row(
            "SELECT tree_size, root_hash FROM signed_tree_heads WHERE checkpoint_digest=?1",
            params![checkpoint_digest],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let (stored_size, stored_root) = stored
            .ok_or_else(|| LedgerError::Invariant("witness checkpoint is not a committed signed tree head".into()))?;
        if stored_size.to_string() != tree_head.tree_size ||
            format!("sha256:{stored_root}") != tree_head.root_hash {
            return Err(LedgerError::Invariant("witness checkpoint does not match persisted tree head".into()));
        }

        let mut seen = HashSet::new();
        let mut verified: Vec<(WitnessSignatureV1, String)> = Vec::new();
        for witness in signatures {
            if witness.witness_id.trim().is_empty() || !seen.insert(witness.witness_id.clone()) {
                return Err(LedgerError::Invariant("duplicate or empty witness identity".into()));
            }
            let key_row: Option<(String, String, String, String, String, Option<String>)> = self.connection.query_row(
                "SELECT witness_id, key_epoch, public_key_hex, not_before_epoch_ms, not_after_epoch_ms, revoked_at_epoch_ms
                 FROM witness_keys WHERE key_id=?1",
                params![witness.key_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            ).optional()?;
            let (registered_witness, registered_epoch, public_hex, not_before, not_after, revoked) = key_row
                .ok_or_else(|| LedgerError::Invariant("unknown witness key".into()))?;
            let valid_from = not_before.parse::<u64>()
                .map_err(|_| LedgerError::Invariant("invalid registered witness not-before timestamp".into()))?;
            let valid_until = not_after.parse::<u64>()
                .map_err(|_| LedgerError::Invariant("invalid registered witness expiry timestamp".into()))?;
            if registered_witness != witness.witness_id || registered_epoch != witness.key_epoch ||
                revoked.is_some() || valid_from > now_epoch_ms || valid_until <= now_epoch_ms {
                return Err(LedgerError::Invariant("witness identity, epoch or validity check failed".into()));
            }
            let public_bytes: [u8; 32] = hex::decode(public_hex)?.try_into()
                .map_err(|_| LedgerError::Invariant("invalid registered witness key".into()))?;
            let verifying_key = VerifyingKey::from_bytes(&public_bytes)
                .map_err(|_| LedgerError::Invariant("invalid registered witness key".into()))?;
            let statement = WitnessStatementV1 {
                schema: "urn:klyn:witness-statement:v1",
                witness_id: witness.witness_id.clone(),
                ledger_id: tree_head.ledger_id.clone(),
                tree_size: tree_head.tree_size.clone(),
                root_hash: tree_head.root_hash.clone(),
                tree_head_digest: checkpoint_digest.clone(),
                checkpoint_key_epoch: tree_head.key_epoch.clone(),
                issued_at_epoch_ms: tree_head.issued_at_epoch_ms.clone(),
            };
            let signature_bytes = BASE64.decode(&witness.signature_base64)
                .map_err(|_| LedgerError::Invariant("witness signature is not valid Base64".into()))?;
            if signature_bytes.len() != 64 || BASE64.encode(&signature_bytes) != witness.signature_base64 {
                return Err(LedgerError::Invariant("witness signature must be canonical Base64 Ed25519".into()));
            }
            let signature_array: [u8; 64] = signature_bytes.try_into()
                .map_err(|_| LedgerError::Invariant("invalid witness signature size".into()))?;
            let canonical_statement = canonicalize(&statement)?;
            verifying_key.verify(&canonical_statement, &Signature::from_bytes(&signature_array))
                .map_err(|_| LedgerError::Invariant("witness signature verification failed".into()))?;
            let statement_json = String::from_utf8(canonical_statement)
                .map_err(|error| LedgerError::Invariant(error.to_string()))?;
            verified.push((witness.clone(), statement_json));
        }

        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT OR IGNORE INTO witness_checkpoint_quorums
             (checkpoint_digest,ledger_id,tree_size,root_hash,threshold,status,created_at_epoch_ms)
             VALUES(?1,?2,?3,?4,?5,'collecting',?6)",
            params![
                checkpoint_digest, tree_head.ledger_id,
                stored_size, tree_head.root_hash, threshold, now_epoch_ms.to_string()
            ],
        )?;
        let (existing_ledger, existing_size, existing_root, existing_threshold): (String, i64, String, i64) = tx.query_row(
            "SELECT ledger_id,tree_size,root_hash,threshold FROM witness_checkpoint_quorums WHERE checkpoint_digest=?1",
            params![checkpoint_digest],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if existing_ledger != tree_head.ledger_id || existing_size != stored_size ||
            existing_root != tree_head.root_hash || existing_threshold != threshold as i64 {
            return Err(LedgerError::Invariant("witness quorum metadata conflict".into()));
        }

        for (witness, statement_json) in verified {
            let previous: Option<(String, String)> = tx.query_row(
                "SELECT key_id, signature_base64 FROM witness_receipts
                 WHERE checkpoint_digest=?1 AND witness_id=?2",
                params![checkpoint_digest, witness.witness_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            if let Some((key_id, signature)) = previous {
                if key_id != witness.key_id || signature != witness.signature_base64 {
                    return Err(LedgerError::Invariant("conflicting receipt already stored for witness/checkpoint".into()));
                }
            } else {
                tx.execute(
                    "INSERT INTO witness_receipts
                     (checkpoint_digest,witness_id,key_id,key_epoch,statement_json,signature_base64,received_at_epoch_ms)
                     VALUES(?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        checkpoint_digest, witness.witness_id, witness.key_id, witness.key_epoch,
                        statement_json, witness.signature_base64, now_epoch_ms.to_string()
                    ],
                )?;
            }
        }
        let ids: Vec<String> = {
            let mut statement = tx.prepare(
                "SELECT witness_id FROM witness_receipts WHERE checkpoint_digest=?1 ORDER BY witness_id",
            )?;
            let rows = statement.query_map(params![checkpoint_digest], |row| row.get::<_, String>(0))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let accepted = ids.len() >= threshold as usize;
        if accepted {
            tx.execute(
                "UPDATE witness_checkpoint_quorums SET status='quorum_met' WHERE checkpoint_digest=?1",
                params![checkpoint_digest],
            )?;
        }
        tx.commit()?;

        Ok(WitnessQuorumStatusV1 {
            checkpoint_digest,
            ledger_id: tree_head.ledger_id,
            tree_size: tree_head.tree_size,
            root_hash: tree_head.root_hash,
            threshold,
            valid_witness_count: ids.len() as u32,
            valid_witness_ids: ids,
            accepted,
        })
    }

    /// Retrieve a stored leaf together with an inclusion path against the latest checkpoint.
    /// The server returns a self-contained cryptographic bundle; callers must still verify
    /// the checkpoint signature and the proof against the checkpoint's root.
    pub fn evidence_proof(&self, evidence_id: &str) -> Result<EvidenceProofBundleV1> {
        let (sequence, leaf_json, leaf_hash_value, envelope_json): (i64, String, String, String) = self.connection.query_row(
            "SELECT l.sequence, l.leaf_json, l.leaf_hash, b.envelope_json
             FROM ledger_leaves l JOIN evidence_blobs b ON b.evidence_id=l.evidence_id
             WHERE l.evidence_id=?1",
            params![evidence_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if sequence < 1 {
            return Err(LedgerError::Invariant("invalid leaf sequence".into()));
        }
        let leaf: LedgerLeafV1 = serde_json::from_str(&leaf_json)?;
        let hashes = self.load_leaf_hashes()?;
        let tree_size = hashes.len();
        let path = klyn_evidence::inclusion_proof(&hashes, (sequence - 1) as usize)?;
        let checkpoint_envelope = self.latest_tree_head()?
            .ok_or_else(|| LedgerError::Invariant("checkpoint missing for non-empty ledger".into()))?;
        let checkpoint_digest = digest_json(&checkpoint_envelope)?;
        let audit_path = path.iter().map(hex::encode).collect::<Vec<_>>();
        let proof = InclusionProofV1 {
            ledger_id: self.ledger_id.clone(),
            leaf_index: (sequence - 1).to_string(),
            tree_size: tree_size.to_string(),
            leaf_hash: leaf_hash_value,
            audit_path,
            tree_head_envelope_digest: checkpoint_digest,
        };
        Ok(EvidenceProofBundleV1 {
            evidence_id: evidence_id.to_owned(),
            leaf,
            evidence_envelope: serde_json::from_str(&envelope_json)?,
            proof,
            checkpoint_envelope,
        })
    }

    /// Return a compact status snapshot used by authenticated IPC health checks.
    pub fn health_snapshot(&self) -> Result<LedgerHealthV1> {
        let size: i64 = self.connection.query_row(
            "SELECT tree_size FROM ledger_meta WHERE ledger_id=?1",
            params![self.ledger_id], |row| row.get(0)
        )?;
        let root: String = self.connection.query_row(
            "SELECT root_hash FROM ledger_meta WHERE ledger_id=?1",
            params![self.ledger_id], |row| row.get(0)
        )?;
        Ok(LedgerHealthV1 {
            ledger_id: self.ledger_id.clone(),
            tree_size: size.to_string(),
            root_hash: format!("sha256:{root}"),
        })
    }

}


/// Reconstruct the RFC 9162 root from persisted complete subtree hashes.
/// Appends update the Merkle frontier in O(log n); a full scan is reserved for startup.
fn root_from_frontier(tx: &rusqlite::Transaction<'_>, size: i64) -> Result<String> {
    if size == 0 {
        return Ok(hex::encode(Sha256::digest(b"")));
    }
    let mut offset = 0i64;
    let mut root: Option<[u8; 32]> = None;
    let highest = 63 - (size as u64).leading_zeros() as i64;
    for level in (0..=highest).rev() {
        let width = 1i64 << level;
        if size & width == 0 { continue; }
        let node_index = offset >> level;
        let encoded: String = tx.query_row(
            "SELECT hash FROM merkle_nodes WHERE level=?1 AND node_index=?2",
            params![level, node_index],
            |row| row.get(0),
        )?;
        let bytes: [u8; 32] = hex::decode(encoded)?.try_into()
            .map_err(|_| LedgerError::Invariant("invalid frontier hash".into()))?;
        root = Some(match root {
            None => bytes,
            Some(previous) => node_hash(&previous, &bytes),
        });
        offset += width;
    }
    root.map(|value| hex::encode(value))
        .ok_or_else(|| LedgerError::Invariant("empty Merkle frontier".into()))
}
