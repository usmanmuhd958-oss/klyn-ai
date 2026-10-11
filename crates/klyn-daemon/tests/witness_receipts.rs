use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use klyn_daemon::{EvidenceStore, WitnessKeyConfigV1, WitnessSignatureV1};
use klyn_evidence::{
    canonicalize, sign_envelope, ArtifactReferenceV1, EvidenceContextV1, EvidenceKind,
    EvidenceOutcomeV1, EvidenceStatementV1, EvidenceStatus, EvidenceSubjectV1,
    TreeHeadV1, EVIDENCE_PAYLOAD_TYPE, EVIDENCE_SCHEMA,
};
use serde::Serialize;
use std::{collections::BTreeMap, path::Path};

const LEDGER_ID: &str = "witness-receipt-ledger";
const PRODUCER_ID: &str = "witness-test-producer";
const CHECKPOINT_ID: &str = "witness-test-checkpoint";

fn producer_key() -> SigningKey { SigningKey::from_bytes(&[0x18; 32]) }
fn checkpoint_key() -> SigningKey { SigningKey::from_bytes(&[0x29; 32]) }
fn producer_keys() -> BTreeMap<String, VerifyingKey> {
    BTreeMap::from([(PRODUCER_ID.to_owned(), producer_key().verifying_key())])
}
fn open_store(path: &Path) -> EvidenceStore {
    EvidenceStore::open(
        path, LEDGER_ID, CHECKPOINT_ID, "1", checkpoint_key(), producer_keys(),
    ).expect("open store")
}
fn append_one(store: &mut EvidenceStore) -> klyn_daemon::AppendReceiptV1 {
    let digest = "sha256:".to_owned() + &"ab".repeat(32);
    let statement = EvidenceStatementV1 {
        schema: EVIDENCE_SCHEMA.into(),
        ledger_id: LEDGER_ID.into(),
        evidence_id: "witness-test-evidence".into(),
        run_id: "witness-test-run".into(),
        sequence_in_run: "1".into(),
        kind: EvidenceKind::ExecutionCompleted,
        producer_id: PRODUCER_ID.into(),
        context: EvidenceContextV1 {
            intent_digest: digest.clone(), plan_digest: digest.clone(),
            policy_digest: digest.clone(), source_tree_digest: digest.clone(),
            runtime_image_digest: digest.clone(),
        },
        subject: EvidenceSubjectV1 {
            repository_uri: "urn:klyn:test".into(), base_revision: "base".into(),
            resulting_tree_digest: None, change_digest: None,
        },
        outcome: EvidenceOutcomeV1 {
            status: EvidenceStatus::Pass, exit_code: Some("0".into()),
            stdout_digest: None, stderr_digest: None,
            started_at_epoch_ms: "10".into(), finished_at_epoch_ms: "11".into(),
        },
        artifacts: Vec::<ArtifactReferenceV1>::new(),
        extensions: BTreeMap::new(),
    };
    let envelope = sign_envelope(EVIDENCE_PAYLOAD_TYPE, &statement, PRODUCER_ID, &producer_key()).unwrap();
    store.append(&envelope, 12, 13).unwrap()
}
fn register(store: &mut EvidenceStore, index: usize, key: &SigningKey) {
    store.configure_witness_key(&WitnessKeyConfigV1 {
        key_id: format!("witness-key-{index}"),
        witness_id: format!("witness-{index}"),
        key_epoch: "1".into(),
        public_key_hex: hex::encode(key.verifying_key().as_bytes()),
        not_before_epoch_ms: "0".into(),
        not_after_epoch_ms: "9999999999999".into(),
        revoked_at_epoch_ms: None,
    }).expect("register witness key");
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WitnessStatement {
    schema: &'static str,
    witness_id: String,
    ledger_id: String,
    tree_size: String,
    root_hash: String,
    tree_head_digest: String,
    checkpoint_key_epoch: String,
    issued_at_epoch_ms: String,
}
fn sign_receipt(
    index: usize,
    key: &SigningKey,
    checkpoint: &klyn_evidence::DsseEnvelopeV1,
    head: &TreeHeadV1,
) -> WitnessSignatureV1 {
    let statement = WitnessStatement {
        schema: "urn:klyn:witness-statement:v1",
        witness_id: format!("witness-{index}"),
        ledger_id: head.ledger_id.clone(),
        tree_size: head.tree_size.clone(),
        root_hash: head.root_hash.clone(),
        tree_head_digest: klyn_evidence::digest_json(checkpoint).unwrap(),
        checkpoint_key_epoch: head.key_epoch.clone(),
        issued_at_epoch_ms: head.issued_at_epoch_ms.clone(),
    };
    WitnessSignatureV1 {
        witness_id: statement.witness_id.clone(),
        key_id: format!("witness-key-{index}"),
        key_epoch: "1".into(),
        signature_base64: BASE64.encode(key.sign(&canonicalize(&statement).unwrap()).to_bytes()),
    }
}

#[test]
fn witness_receipts_are_verified_persisted_and_quorum_is_idempotent() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("witnesses.sqlite3");
    let mut store = open_store(&database);
    let append = append_one(&mut store);
    let payload = BASE64.decode(&append.checkpoint_envelope.payload).unwrap();
    let head: TreeHeadV1 = serde_json::from_slice(&payload).unwrap();
    let witness_keys = [
        SigningKey::from_bytes(&[0x31; 32]),
        SigningKey::from_bytes(&[0x32; 32]),
        SigningKey::from_bytes(&[0x33; 32]),
    ];
    for (index, key) in witness_keys.iter().enumerate() { register(&mut store, index, key); }

    let first = sign_receipt(0, &witness_keys[0], &append.checkpoint_envelope, &head);
    let partial = store.submit_witness_receipts(
        &append.checkpoint_envelope, &[first.clone()], 2, 100,
    ).expect("persist partial receipt");
    assert!(!partial.accepted);
    assert_eq!(partial.valid_witness_count, 1);

    let second = sign_receipt(1, &witness_keys[1], &append.checkpoint_envelope, &head);
    let complete = store.submit_witness_receipts(
        &append.checkpoint_envelope, &[second.clone()], 2, 101,
    ).expect("reach quorum");
    assert!(complete.accepted);
    assert_eq!(complete.valid_witness_count, 2);
    assert_eq!(complete.valid_witness_ids, vec!["witness-0", "witness-1"]);

    let replay = store.submit_witness_receipts(
        &append.checkpoint_envelope, &[first, second], 2, 102,
    ).expect("idempotent receipt replay");
    assert!(replay.accepted);
    assert_eq!(replay.valid_witness_count, 2);

    let forged = WitnessSignatureV1 {
        witness_id: "witness-2".into(),
        key_id: "witness-key-2".into(),
        key_epoch: "1".into(),
        signature_base64: BASE64.encode([0u8; 64]),
    };
    assert!(store.submit_witness_receipts(
        &append.checkpoint_envelope, &[forged], 2, 103,
    ).is_err());
}
