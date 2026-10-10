# KLYN Evidence Ledger (KEL) v1 — protocol and operations

This document is the implementation contract for the KEL v1 baseline and its authenticated local RPC boundary. KEL records signed claims plus verifiable inclusion into an append-only hash log. Cryptographic acceptance is not equivalent to proof that a claim is factually true.

## 1. Wire and cryptographic contract

- Evidence payload type: \`application/vnd.klyn.evidence.v1+json\`.
- Tree-head payload type: \`application/vnd.klyn.tree-head.v1+json\`.
- UTF-8 JSON signed payloads use RFC 8785 JSON Canonicalization Scheme (JCS).
- DSSE v1 signatures cover the pre-authentication encoding \`DSSEv1 <type-byte-length> <type> <payload-byte-length> <payload>\`; both lengths are UTF-8 byte counts.
- Hash algorithm: SHA-256. Merkle tree algorithm: ordered RFC 9162.
- Leaf hash: \`SHA256(0x00 || canonical_leaf_bytes)\`.
- Interior hash: \`SHA256(0x01 || left_hash_32_bytes || right_hash_32_bytes)\`.
- Empty tree root: \`SHA256(empty_bytes)\`.
- Hash values are lowercase 64-digit hexadecimal; APIs that specify a digest prefix use \`sha256:<hex>\`.
- Sequence numbers, tree sizes, epochs and timestamps in signed protocol objects use unsigned decimal strings, avoiding JSON-number precision ambiguity.

## 2. Local RPC v1

The Rust daemon exposes a Unix-domain socket. It must be reachable only inside a private service directory; the socket is set to mode \`0600\`. Do not place it in a shared writable directory unless a service manager provides equivalent isolation.

### Frame format

Every request and response is framed as:

1. Four-byte unsigned big-endian payload length.
2. Exactly that many UTF-8 JSON bytes.
3. Maximum payload: 1,048,576 bytes. Zero-length and oversized frames are rejected.

Request fields are exact and case-sensitive; unknown fields are rejected:

\`\`\`json
{
  "version": 1,
  "id": "request-id",
  "token": "<64 hex characters>",
  "method": "ledger.health",
  "params": {}
}
\`\`\`

The \`token\` is 32 random bytes represented as 64 hexadecimal characters. Requests without a valid token are not dispatched. Generate it with a cryptographically secure random generator and deliver it through a secret manager or protected service environment; never commit it or expose it in logs.

Responses echo the same \`id\` and version. Successful responses contain \`result\`; failed responses contain \`error: { "code": "...", "message": "..." }\`. Clients must reject mismatched IDs/versions, malformed JSON, truncated frames and payloads beyond the frame limit.

### Methods

**\`ledger.health\`**

Parameters: \`{}\`.

Result:
\`\`\`json
{ "ledgerId": "ledger-name", "treeSize": "12", "rootHash": "sha256:<64-hex>" }
\`\`\`

**\`evidence.append\`**

Parameters: \`{ "envelope": <DsseEnvelopeV1> }\`. The producer DSSE signature, canonical payload, schema, ledger ID and evidence policy's structural requirements are validated by the Rust store before the SQLite write transaction begins.

The result is \`AppendReceiptV1\`, including evidence ID, sequence, envelope digest, leaf hash, tree size, root hash, signed tree-head envelope and \`idempotentReplay\`. A retry of the same evidence ID and envelope digest returns the existing receipt. Reusing an evidence ID for different content fails with \`idempotency_conflict\`.

**\`proof.get\`**

Parameters: \`{ "evidenceId": "..." }\`. Result is \`EvidenceProofBundleV1\`: the stored producer envelope, signed ledger leaf, RFC 9162 inclusion proof, and signed tree-head envelope. A verifier must check producer authentication, the leaf-to-envelope digest binding, the checkpoint signature and key epoch, the inclusion path, and any configured consistency/witness/evidence-policy rules. A proof path alone is not a complete trust decision.

### Error codes

- \`unauthenticated\`: token failed authentication.
- \`unsupported_version\`: unsupported RPC version.
- \`invalid_request_id\`, \`invalid_params\`: request shape or parameter is invalid.
- \`method_not_found\`: unknown method.
- \`idempotency_conflict\`: same evidence ID was submitted with different content.
- \`ledger_mismatch\`, \`invalid_evidence\`: evidence was rejected by ledger/schema/signature validation.
- \`not_found\`: no record exists for the requested evidence ID.
- \`ledger_unavailable\`, \`proof_unavailable\`, \`internal_error\`: an internal operation failed; internal DB/key details are not returned to the client.

## 3. Daemon startup and secret inputs

The \`klyn-daemon\` binary currently accepts configuration via environment variables:

- \`KEL_SOCKET_PATH\`: socket path, preferably under a dedicated \`0700\` service directory.
- \`KEL_DATABASE_PATH\`: SQLite database path on a persistent local filesystem.
- \`KEL_LEDGER_ID\`: configured ledger identifier.
- \`KEL_RPC_AUTH_TOKEN_HEX\`: 32 random bytes represented by 64 hex characters.
- \`KEL_CHECKPOINT_KEY_ID\`, \`KEL_CHECKPOINT_KEY_EPOCH\`: checkpoint signing-key identity and decimal epoch.
- \`KEL_CHECKPOINT_PRIVATE_KEY_HEX\`: raw 32-byte Ed25519 seed in hex.
- \`KEL_PRODUCER_KEYS_JSON\`: JSON object mapping producer key IDs to 32-byte raw Ed25519 public keys in hex.

**The private-key environment variable is a bootstrap mechanism, not an HSM/KMS integration.** A production rollout should replace it with a locked-down key provider, avoid secrets in process environments when the platform supports safer injection, and explicitly set process user/group, file-system permissions, resource limits, service restart policy and log redaction. The RPC server currently has process-supervisor lifecycle semantics rather than a full administrative control API.

## 4. Persistence and restart semantics

SQLite uses WAL mode, foreign keys and \`synchronous=FULL\`. Evidence envelope, leaf, Merkle nodes, signed tree head and metadata update in a single immediate write transaction. Evidence, leaf, node and checkpoint rows are guarded against updates/deletes by triggers. Startup scans all leaf hashes and compares the computed Merkle root and leaf count with metadata.

The integration harness covers restart integrity, duplicate append replay, conflicting replays, inclusion proof verification, a process abort after commit, and a debug-only abort before transaction commit. WAL recovery must discard uncommitted changes and preserve committed records. The debug failpoint is compiled out of release builds.

These properties protect against process crashes and ordinary application mistakes. They do not protect a local SQLite file against a privileged host operator who can rewrite both data and metadata. For rollback/split-view resistance, publish signed checkpoints to independently administered witness services or an external append-only anchor.

## 5. Witness quorum and key lifecycle

The governance package supplies a 3-witness verification policy with configurable threshold 2 or 3 (default 2). Each accepted witness must be configured, unique, bound to the key registry's witness identity, and have a valid Ed25519 signature over a JCS witness statement that binds the ledger ID, tree size, root hash and signed checkpoint digest. Duplicate or unconfigured witness IDs do not count.

Key records contain key ID, subject, purpose, decimal epoch, Ed25519 public key, not-before/not-after timestamps and optional revocation timestamp. IDs are never reused. Rotations must preserve subject and purpose and increase epoch; revoked, expired, not-yet-valid, wrong-purpose or wrong-epoch keys fail closed. The JSON file adapter is intended for single-writer deployments: it uses mode 0600, an fsync + atomic rename, directory fsync and revision conflict detection. Multi-process/host deployments should replace it with a transactional database-backed adapter. Revocation is deliberately retroactive in the current verifier; historical verification semantics should be specified before using this for long-retention evidence.

The control plane's \`verifyEvidence()\` reports a partial cryptographic result and deliberately leaves \`accepted=false\` when a witness quorum and domain evidence policy have not been supplied. \`verifyEvidenceWithWitnesses()\` only returns \`accepted=true\` after producer authentication, checkpoint authentication, Merkle inclusion, witness quorum and a caller-defined evidence policy all pass.

Witness signatures are currently supplied to the verifier by the control plane; daemon-side witness receipt persistence and an independently deployed witness network are not included in this change.

## 6. Legacy governance migration

\`LegacyGovernanceKelAdapter\` maps calls from \`AuditLedger\` and \`ArtifactAttestor\` into KEL v1 producer-signed statements. Deterministic evidence IDs preserve idempotency on transport retries. The adapter preserves the legacy return objects while adding KEL receipts; consumers can migrate gradually, then choose KEL proofs as their audit source of truth.

A legacy in-memory/file/database append and the separate KEL daemon append are not one distributed ACID transaction. For a no-loss migration, callers need a durable transactional outbox and replay worker; only acknowledge a legacy operation after the outbox record itself is durable. The adapter included here provides the mapping facade, not that outbox implementation.

## 7. Operational hardening still required before production certification

This implementation is an operational integration milestone, not independent production security certification. Before claiming production grade, add and verify: HSM/KMS-backed private-key custody; a dedicated socket parent directory and peer-credential policy (in addition to token auth); graceful shutdown and bounded connection/concurrency controls; durable witness receipt/checkpoint anchoring; transactional outbox for legacy dual writes; cross-language RFC 8785/RFC 9162 golden vectors; property/fuzz tests; sustained-load and resource-exhaustion tests; restore drills and external backup verification; and an independent security review. Never use a signed claim as a substitute for validating what its claim says.
