# KLYN Evidence Ledger (KEL) v1 — implementation contract

This document records the repository implementation contract for the initial KEL v1 milestone.

## Wire and cryptographic rules

- Evidence and tree-head payloads are UTF-8 JSON canonicalized with RFC 8785 JCS.
- DSSE signatures cover the DSSE v1 pre-authentication encoding, using byte lengths.
- Evidence payload type: `application/vnd.klyn.evidence.v1+json`.
- Tree-head payload type: `application/vnd.klyn.tree-head.v1+json`.
- Hash algorithm: SHA-256.
- Ordered Merkle algorithm: RFC 9162.
- Leaf hash: `SHA256(0x00 || canonical_leaf_bytes)`.
- Interior hash: `SHA256(0x01 || left_hash_32_bytes || right_hash_32_bytes)`.
- Empty root: `SHA256(empty_bytes)`.
- Hex digests are lowercase and contain exactly 64 hexadecimal characters; protocol-facing digests may use the `sha256:` prefix where specified.
- Sequence numbers, sizes, and timestamps inside signed protocol objects are decimal strings.

## Trust boundaries

The Rust `klyn-evidence` crate is the normative protocol implementation. The daemon owns persistence and access to checkpoint signing keys. The TypeScript package is a control-plane bridge and must not be treated as the authority for key custody or ledger persistence.

A valid signature authenticates a signed claim; it does not prove the claim is factually true. Completion acceptance must separately validate evidence policy and the source/artifact digests under test.

## Persistence guarantees

The daemon enables SQLite WAL and FULL synchronous mode. Appends validate the producer envelope and evidence schema before the write transaction, enforce evidence-ID idempotency, and atomically persist the blob, leaf, Merkle nodes, checkpoint, and metadata. A retry with the same evidence ID and envelope digest returns the original receipt; a retry with a different digest is a conflict.

## Current scope and required hardening

This first implementation is an integration baseline, not a claim of independent production security certification. Before production deployment, add independent witness quorum persistence, key-registry and revocation policy, externally anchored checkpoints, crash-injection tests, RFC 8785/RFC 9162 published golden vectors, fuzzing, and cross-language Rust/TypeScript conformance tests. The current Rust store performs a full integrity scan on open; steady-state append uses the persisted Merkle frontier.
