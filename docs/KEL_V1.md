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

The `klyn-daemon` process accepts non-private configuration through environment variables:

- `KEL_SOCKET_PATH`: RPC socket under a dedicated private service directory.
- `KEL_DATABASE_PATH`: SQLite database path on persistent local storage.
- `KEL_LEDGER_ID`: ledger identifier.
- `KEL_RPC_AUTH_TOKEN_HEX`: 32 random bytes encoded as 64 hexadecimal characters.
- `KEL_SIGNER_SOCKET_PATH`: Unix socket for the isolated external signer.
- `KEL_SIGNER_AUTH_TOKEN_FILE`: protected token file for the signer connection; it must be a regular file with mode `0600` or stricter.
- `KEL_PRODUCER_KEYS_JSON`: object mapping producer key IDs to 32-byte raw Ed25519 public keys in hex.
- `KEL_RPC_ALLOWED_UID`: Linux UID allowed to connect; defaults to the daemon's effective UID.
- `KEL_RPC_MAX_CONNECTIONS`: active client limit; defaults to 64, with a hard maximum of 1024.
- `KEL_WITNESS_KEYS_JSON`: optional array of witness public-key records (key ID, witness identity, epoch, public-key hex, validity interval and optional revocation time).

**The daemon does not load or receive the checkpoint private seed.** It connects to `ExternalSignerClient`, which gets checkpoint key metadata and signatures from an isolated signer agent. The `Ed25519HsmKmsDriver` interface can wrap a PKCS#11 session or cloud KMS signing API. The included PKCS#11/cloud adapters are provider-injection interfaces; the deployment must supply a concrete provider driver and validate its key policy, credentials, signature encoding and lifecycle using the actual vendor service.

Use a dedicated socket parent directory owned by the service account with mode `0700`; do not place the socket directly under a world-writable directory such as `/tmp`. Service deployment should also enforce least-privilege user/group, filesystem policy, resource limits, secret redaction and restart policy.

## 4. Persistence and restart semantics

SQLite uses WAL mode, foreign keys and \`synchronous=FULL\`. Evidence envelope, leaf, Merkle nodes, signed tree head and metadata update in a single immediate write transaction. Evidence, leaf, node and checkpoint rows are guarded against updates/deletes by triggers. Startup scans all leaf hashes and compares the computed Merkle root and leaf count with metadata.

The integration harness covers restart integrity, duplicate append replay, conflicting replays, inclusion proof verification, a process abort after commit, and a debug-only abort before transaction commit. WAL recovery must discard uncommitted changes and preserve committed records. The debug failpoint is compiled out of release builds.

These properties protect against process crashes and ordinary application mistakes. They do not protect a local SQLite file against a privileged host operator who can rewrite both data and metadata. For rollback/split-view resistance, publish signed checkpoints to independently administered witness services or an external append-only anchor.

## 5. Witness quorum and key lifecycle

The governance package supplies a three-witness policy with configurable threshold 2 or 3 (default 2). Each accepted witness must be configured, unique, bound to a registered witness identity, and have a valid Ed25519 signature over a JCS statement binding the ledger ID, tree size, root hash and signed checkpoint digest. Duplicate and unconfigured identities do not contribute to quorum.

Key records contain a key ID, subject/witness identity, purpose, decimal epoch, Ed25519 public key, validity interval and optional revocation timestamp. Key IDs are never reused; rotations preserve identity and purpose and increase the epoch. Revoked, expired, not-yet-valid, wrong-purpose and wrong-epoch keys are rejected. The JSON registry adapter is for single-writer use and performs atomic fsync/rename with revision checks; use a transactional database adapter for multi-process/multi-host registry management.

The daemon additionally exposes `witness.receipts.submit` and persists public witness keys, immutable receipt rows and checkpoint quorum state in SQLite WAL. It verifies each receipt's signature, identity, epoch and validity interval itself. Valid partial receipt sets remain `collecting`; the checkpoint is marked `quorum_met` only after the configured threshold is reached.

The governance package now includes `WitnessNetworkWorker`, an independent HTTPS worker that requires mutual TLS and a separate bearer token. It uses durable SQLite receipt storage, asks a separate signer provider to sign the local witness statement, validates incoming gossip itself, applies body and concurrency limits, and gossips receipt sets to configured peers. A peer's claimed `accepted` flag is not trusted; each node recomputes the quorum from the individual signatures. Deploy three independently administered workers with distinct keys and trust boundaries.

`verifyEvidence()` deliberately reports only a partial result and keeps `accepted=false` until a witness quorum and evidence policy are supplied. `verifyEvidenceWithWitnesses()` returns `accepted=true` only after producer authentication, checkpoint authentication, inclusion proof, witness quorum and caller-defined evidence policy all pass.

The worker and daemon provide the network/persistence interfaces; deployment still needs real HSM/KMS drivers, independently provisioned certificates and trust roots, and externally anchored checkpoints. The local ledger and witness tables alone cannot prevent a privileged host operator from rewriting all local data.

## 6. Legacy governance migration

`LegacyGovernanceKelAdapter` maps calls from `AuditLedger` and `ArtifactAttestor` into signed KEL v1 evidence statements. The durable path uses `SqliteAuditStorageAdapter`, which writes `audit_records` and `kel_outbox` inside the **same SQLite `BEGIN IMMEDIATE` transaction**. The outbox stores deterministic event IDs and the complete signed envelope(s), together with creation time, retry count and delivery status.

The drain worker delivers events in order. Failed deliveries remain pending and are retried; partial remote success is safe to replay because KEL appends are idempotent by evidence ID. For an artifact attestation, both the legacy audit evidence and artifact evidence are stored in one outbox bundle before network delivery.

Use SQLite storage for production outbox guarantees. The in-memory adapter exists for tests only; file-JSONL storage cannot atomically commit an audit record and an outbox row and therefore fails closed for `appendWithOutbox`. The local transaction is atomic, but delivery to the separate KEL daemon is not a distributed ACID transaction; correctness relies on durable retry and idempotent append. A `queued: true` result means the payload has been committed locally but not yet delivered; monitor pending count, age and failure count.

## 7. RPC, concurrency and shutdown hardening

The daemon requires Linux `SO_PEERCRED` UID equality and the bearer token, sets the socket to mode `0600`, refuses to replace a non-socket path, and requires a private parent directory. It bounds active RPC sessions (default 64; maximum 1024), applies five-second per-connection I/O timeouts, caps frames at 1 MiB, and rejects malformed or oversized frames. SIGTERM/SIGINT stops new accepts, drains active handlers and removes the socket. Capacity-rejected connections are closed without parsing attacker-controlled payloads. Tests cover authentication-before-dispatch, frame limits, peer credentials and the connection-cap primitive.

The independent witness worker additionally limits inbound JSON bodies to 256 KiB, caps concurrent requests and configured peer count, uses TLS client certificates for node-to-node traffic, verifies a separate bearer token, and places deadlines on outbound peer requests.

## 8. Test and operational checks

The KEL conformance workflow runs Rust daemon/evidence tests and the governance TypeScript typecheck/test suite. Current harness coverage includes WAL crash/restart, append idempotency, witness receipt verification/quorum and persistence, signer-agent framing/signature validation, key lifecycle policies, transactional outbox replay/rollback, and RPC admission checks.

Before rolling out the real HSM/KMS, add a deployment-level interoperability test against the chosen vendor service and certificate setup. Exercise capacity under sustained load, partial socket writes, worker termination, network partitions, witness equivocation, key revocation and database restore.

## 9. Residual production-certification requirements

The branch now includes these hardening interfaces and service modules, but it is **not independently security-certified or automatically production-ready**. Before high-assurance production use:

- Bind the signer provider to a concrete HSM/cloud KMS key with least-privilege policies, rotation, audit logging, emergency revoke procedures and recovery drills. The provider adapters here are interfaces, not a tested vendor integration.
- Deploy at least three independently administered witness workers with distinct signing keys and separate operator access. Provision trust roots/certificates out of band and anchor signed checkpoints outside the daemon database to detect privileged local rollback and split view.
- Verify database and secret-file permissions, backup integrity, restore procedures, outbox/witness lag monitoring, and operational SLOs.
- Add cross-language RFC 8785/RFC 9162 golden vectors, property-based/fuzz testing, long-duration/resource-exhaustion benchmarks, concurrent multi-process tests and an independent security review.
- Specify historical verification behavior after key revocation/rotation; the current registry rejects currently revoked keys retroactively.

A valid signature authenticates a statement, but does not prove the statement's claims are true. Evidence policy and independent verification remain mandatory.

