use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{SigningKey, VerifyingKey};
use klyn_daemon::EvidenceStore;
use klyn_evidence::{
    merkle_root, sign_envelope, verify_inclusion, TreeHeadV1,
    EvidenceContextV1, EvidenceKind, EvidenceOutcomeV1,
    EvidenceStatementV1, EvidenceStatus, EvidenceSubjectV1,
    EVIDENCE_PAYLOAD_TYPE, EVIDENCE_SCHEMA,
};
use std::{collections::BTreeMap, env, path::{Path, PathBuf}, process::Command};

const LEDGER_ID: &str = "crash-conformance-ledger";
const PRODUCER_ID: &str = "producer-test-key";
const CHECKPOINT_ID: &str = "checkpoint-test-key";

fn producer_key() -> SigningKey {
    SigningKey::from_bytes(&[0x21; 32])
}
fn checkpoint_key() -> SigningKey {
    SigningKey::from_bytes(&[0x42; 32])
}
fn producer_keys() -> BTreeMap<String, VerifyingKey> {
    BTreeMap::from([(PRODUCER_ID.to_owned(), producer_key().verifying_key())])
}
fn open_store(path: &Path) -> EvidenceStore {
    EvidenceStore::open(
        path,
        LEDGER_ID,
        CHECKPOINT_ID,
        "1",
        checkpoint_key(),
        producer_keys(),
    ).expect("open ledger")
}
fn evidence(evidence_id: &str, run_id: &str, sequence: u64) -> EvidenceStatementV1 {
    let digest = "sha256:".to_owned() + &"ab".repeat(32);
    EvidenceStatementV1 {
        schema: EVIDENCE_SCHEMA.to_owned(),
        ledger_id: LEDGER_ID.to_owned(),
        evidence_id: evidence_id.to_owned(),
        run_id: run_id.to_owned(),
        sequence_in_run: sequence.to_string(),
        kind: EvidenceKind::ExecutionCompleted,
        producer_id: PRODUCER_ID.to_owned(),
        context: EvidenceContextV1 {
            intent_digest: digest.clone(),
            plan_digest: digest.clone(),
            policy_digest: digest.clone(),
            source_tree_digest: digest.clone(),
            runtime_image_digest: digest.clone(),
        },
        subject: EvidenceSubjectV1 {
            repository_uri: "urn:klyn:test-repo".to_owned(),
            base_revision: "revision-0".to_owned(),
            resulting_tree_digest: None,
            change_digest: None,
        },
        outcome: EvidenceOutcomeV1 {
            status: EvidenceStatus::Pass,
            exit_code: Some("0".to_owned()),
            stdout_digest: None,
            stderr_digest: None,
            started_at_epoch_ms: "1000".to_owned(),
            finished_at_epoch_ms: "1001".to_owned(),
        },
        artifacts: Vec::<ArtifactReferenceV1>::new(),
        extensions: BTreeMap::new(),
    }
}
fn envelope(evidence_id: &str, run_id: &str, sequence: u64) -> DsseEnvelopeV1 {
    sign_envelope(
        EVIDENCE_PAYLOAD_TYPE,
        &evidence(evidence_id, run_id, sequence),
        PRODUCER_ID,
        &producer_key(),
    ).expect("sign evidence envelope")
}
fn decode_hash(value: &str) -> [u8; 32] {
    hex::decode(value.strip_prefix("sha256:").unwrap_or(value))
        .expect("hex digest").try_into().expect("32-byte hash")
}

#[test]
fn restart_preserves_root_idempotency_and_inclusion_proofs() {
    let directory = tempfile::tempdir().expect("temp directory");
    let database = directory.path().join("ledger.sqlite3");
    let mut store = open_store(&database);
    let mut envelopes = Vec::new();
    let mut expected_hashes = Vec::new();

    for index in 0..9u64 {
        let input = envelope(&format!("evidence-{index}"), "run-restart", index + 1);
        let receipt = store.append(&input, 2000 + index, 3000 + index).expect("append");
        assert!(!receipt.idempotent_replay);
        expected_hashes.push(decode_hash(&receipt.leaf_hash));
        envelopes.push(input);
    }
    let expected_root = merkle_root(&expected_hashes);
    drop(store);

    let mut reopened = open_store(&database);
    assert_eq!(reopened.leaf_count().expect("count after restart"), 9);
    assert_eq!(reopened.health_snapshot().unwrap().root_hash, format!("sha256:{}", hex::encode(expected_root)));

    let replay = reopened.append(&envelopes[3], 99, 99).expect("idempotent replay");
    assert!(replay.idempotent_replay);
    assert_eq!(replay.sequence, "4");
    assert_eq!(decode_hash(&replay.root_hash), expected_root);
    assert!(matches!(
        reopened.append(&envelope("evidence-3", "different-run", 999), 100, 100),
        Err(klyn_daemon::LedgerError::IdempotencyConflict(_))
    ));
    assert_eq!(reopened.leaf_count().unwrap(), 9);

    let bundle = reopened.evidence_proof("evidence-3").expect("proof retrieval");
    let path_hashes: Vec<[u8; 32]> = bundle.proof.audit_path.iter().map(|item| {
        hex::decode(item).expect("proof hex").try_into().expect("proof hash")
    }).collect();
    assert!(verify_inclusion(
        decode_hash(&bundle.proof.leaf_hash),
        bundle.proof.leaf_index.parse::<usize>().unwrap(),
        bundle.proof.tree_size.parse::<usize>().unwrap(),
        &path_hashes,
        expected_root,
    ));
    assert_eq!(bundle.leaf.evidence_id, "evidence-3");
    assert_eq!(bundle.proof.tree_head_envelope_digest, klyn_evidence::digest_json(&bundle.checkpoint_envelope).unwrap());
}

#[test]
fn child_process_crash_worker() {
    let database = match env::var_os("KEL_TEST_CHILD_DB") {
        Some(value) => PathBuf::from(value),
        None => return, // Normal test-harness invocation; the parent test launches this test by name.
    };
    let mode = env::var("KEL_TEST_CHILD_MODE").expect("crash mode");
    let mut store = open_store(&database);
    let input = envelope("crash-window-evidence", "run-crash", 1);

    if mode == "before-commit" {
        // The debug-only failpoint aborts inside append after writes but before COMMIT.
        env::set_var("KEL_TEST_CRASH_BEFORE_COMMIT", "1");
        let _ = store.append(&input, 5000, 5000);
        panic!("pre-commit failpoint did not terminate the child");
    } else {
        store.append(&input, 5000, 5000).expect("committed append");
        // Kill the process without running Rust destructors / SQLite close handlers.
        std::process::abort();
    }
}

fn run_crashing_child(database: &Path, mode: &str) {
    let executable = env::current_exe().expect("test executable");
    let status = Command::new(executable)
        .arg("--exact")
        .arg("child_process_crash_worker")
        .arg("--nocapture")
        .env("KEL_TEST_CHILD_DB", database)
        .env("KEL_TEST_CHILD_MODE", mode)
        .env_remove("KEL_TEST_CRASH_BEFORE_COMMIT")
        .status()
        .expect("spawn crash child");
    assert!(!status.success(), "crash child should terminate abnormally for mode {mode}");
}

#[test]
fn wal_recovery_discards_uncommitted_transaction_after_sigkill_style_abort() {
    let directory = tempfile::tempdir().expect("temp directory");
    let database = directory.path().join("pre-commit-crash.sqlite3");
    // Warm schema once so the child crash occurs inside an append transaction, not DDL.
    drop(open_store(&database));
    run_crashing_child(&database, "before-commit");

    let mut recovered = open_store(&database);
    assert_eq!(recovered.leaf_count().unwrap(), 0, "uncommitted append must not survive recovery");
    let receipt = recovered.append(&envelope("crash-window-evidence", "run-crash", 1), 6000, 6000)
        .expect("ledger usable after recovery");
    assert_eq!(receipt.sequence, "1");
    assert_eq!(recovered.leaf_count().unwrap(), 1);
}

#[test]
fn wal_recovery_preserves_committed_append_after_abrupt_process_exit() {
    let directory = tempfile::tempdir().expect("temp directory");
    let database = directory.path().join("post-commit-crash.sqlite3");
    drop(open_store(&database));
    run_crashing_child(&database, "after-commit");

    let recovered = open_store(&database);
    assert_eq!(recovered.leaf_count().unwrap(), 1);
    let health = recovered.health_snapshot().expect("health after committed crash");
    assert_eq!(health.tree_size, "1");
    let proof = recovered.evidence_proof("crash-window-evidence").expect("committed evidence present");
    assert_eq!(proof.proof.tree_size, "1");
    let head_payload = BASE64.decode(&proof.checkpoint_envelope.payload).expect("checkpoint payload base64");
    let head: TreeHeadV1 = serde_json::from_slice(&head_payload).expect("checkpoint tree head");
    assert_eq!(decode_hash(&health.root_hash), decode_hash(&head.root_hash));
}
