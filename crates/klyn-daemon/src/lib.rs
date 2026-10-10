//! Durable SQLite WAL storage for KEL v1.
//!
//! The daemon owns persistence and key use. Private keys must be supplied by a
//! trusted key provider/HSM in production; never load them from agent-controlled input.

pub mod rpc;

use ed25519_dalek::{SigningKey, VerifyingKey};
use klyn_evidence::{
    canonicalize, digest_json, envelope_digest, leaf_hash, merkle_root, node_hash, sign_envelope,
    validate_evidence, verify_envelope, DsseEnvelopeV1, EvidenceStatementV1, LedgerLeafV1,
    InclusionProofV1, TreeHeadV1, EVIDENCE_PAYLOAD_TYPE, TREE_HEAD_PAYLOAD_TYPE,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};
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

pub struct EvidenceStore {
    connection: Connection,
    ledger_id: String,
    checkpoint_key_id: String,
    checkpoint_key_epoch: String,
    checkpoint_signing_key: SigningKey,
    producer_keys: BTreeMap<String, VerifyingKey>,
}

impl EvidenceStore {
    pub fn open(
        path: impl AsRef<Path>,
        ledger_id: impl Into<String>,
        checkpoint_key_id: impl Into<String>,
        checkpoint_key_epoch: impl Into<String>,
        checkpoint_signing_key: SigningKey,
        producer_keys: BTreeMap<String, VerifyingKey>,
    ) -> Result<Self> {
        let ledger_id = ledger_id.into();
        let checkpoint_key_epoch = checkpoint_key_epoch.into();
        if ledger_id.trim().is_empty() {
            return Err(LedgerError::Invariant("ledger id is required".into()));
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
            checkpoint_key_id: checkpoint_key_id.into(),
            checkpoint_key_epoch,
            checkpoint_signing_key,
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
        let checkpoint_envelope = sign_envelope(
            TREE_HEAD_PAYLOAD_TYPE, &tree_head, &self.checkpoint_key_id, &self.checkpoint_signing_key
        )?;
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
