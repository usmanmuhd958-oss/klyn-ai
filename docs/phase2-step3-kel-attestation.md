# KLYN Phase 2 Step 3 — KEL-Bound Lifecycle Attestation

## Security contract

KEL v1 is a per-worker, single-writer SHA-256 hash-chained journal. Every record is
fixed-width and explicitly encoded; Rust struct memory layout and padding are never
serialized. The daemon's Ed25519 key signs each event hash. A worker-attestation
record additionally contains the ephemeral worker public key and its signature over a
fresh challenge that binds the session, host launcher PID, cgroup inode, signed
manifest digest, signed capability digest, worker executable digest, and trusted
daemon public key.

The journal file is created exclusively (existing paths are rejected), uses owner-only
permissions, and is opened in append mode. Each record is synced before the in-memory
head root advances. Records are never overwritten by KEL APIs; append attempts first
verify the persisted prefix against the in-memory sequence and root. The monitor repeats
this check during the worker's lifetime and sends any failure to the cgroup kill path.

## Event schema

Each record is 461 bytes, encoded little-endian for integer fields:

| Field | Width |
| --- | ---: |
| Sequence number | 8 bytes |
| Timestamp (Unix nanoseconds) | 8 bytes |
| Event kind | 1 byte |
| Session ID | 16 bytes |
| Payload SHA-256 | 32 bytes |
| Previous event hash | 32 bytes |
| Current event hash | 32 bytes |
| Daemon signer public key | 32 bytes |
| Daemon Ed25519 signature | 64 bytes |
| Worker attestation proof | 236 bytes |

The event hash is SHA-256 over the domain separator, sequence, timestamp, event kind,
session ID, payload hash, predecessor hash, daemon public key, and every field in the
worker proof. The daemon signature covers that event hash. The chain starts with a
zero predecessor and sequence 0.

Supported events are `CapabilityValidated`, `CapabilityRejected`, `Spawn`,
`WorkerAttested`, `PolicyGateClear`, `TelemetryAnomaly`, and `CgroupDestroy`.
The journal enforces lifecycle transitions; after `CgroupDestroy` no further record
is accepted. A rejected capability is terminal for that journal.

## Shared-memory attestation sequence

1. The supervisor validates the signed OCap capability, configures the cgroup, seals
   the worker manifest, and records `CapabilityValidated`.
2. Once the blocked launcher is attached to the cgroup and controls are read back,
   the supervisor records `Spawn` with the host PID, cgroup identifier, manifest hash,
   and executable hash. The supervisor then starts the mandatory cgroup monitor and
   waits until cgroup sampling is active and the optional eBPF loader has either
   attached its probes or explicitly selected cgroup-only fallback. This completes
   before the challenge exchange and final mission release.
3. After independently verifying the signed manifest and capability, confirming
   cgroup controls, connecting the broker, and installing Landlock/seccomp, the worker
   waits for a fixed 189-byte challenge on the already-mapped SPSC command ring. It
   does this before sending POLICY_READY on the private gate socket. The challenge
   contains opcode 0x03, session ID, a kernel-random 32-byte nonce, launcher PID, cgroup
   identifier, manifest/capability/executable hashes, and the daemon public key.
4. The worker validates that the challenge matches its independently verified launch
   identity. It signs the domain-separated challenge digest with a fresh per-process
   Ed25519 key and returns a fixed 97-byte response (opcode 0x83, worker public key,
   worker signature) on the SPSC response ring.
5. The supervisor verifies the worker signature and durably appends `WorkerAttested`.
   It then validates the worker's private-gate POLICY_READY token, appends
   `PolicyGateClear`, and only then sends MISSION_RELEASE. Only after this exchange
   does `launch_worker_with_kel` return the worker handle to the daemon.
6. Telemetry anomalies append `TelemetryAnomaly` and trigger cgroup-v2 `cgroup.kill`.
   Once `cgroup.events` confirms `populated 0`, the monitor appends terminal
   `CgroupDestroy`. Supervisor cleanup is also wired to append that terminal event.

The challenge and response use stack-backed fixed arrays and existing SPSC ring
reservations. Event encoding and hash calculation use fixed-size stack buffers; there
is no JSON allocation on the handshake frame path. KEL durability uses file I/O and
Ed25519/SHA-256 work only on lifecycle / attestation / anomaly paths, not for every
ordinary ping frame.

## Head-root anchoring and limitations

The daemon exposes a verified `KelHeadSnapshot` containing session ID, next sequence,
and head hash. A trusted deployment should store that snapshot independently (for
example, in a TPM/HSM-protected monotonic store or remote append-only audit service) and
compare it after restart. The current implementation does not provision or call a TPM,
HSM, or remote anchor itself. A local signature chain detects in-place mutation and
broken/reordered records, but by itself it cannot detect deletion of a complete tail or
rollback to an older signed prefix when the expected head is not independently stored.

The worker key is ephemeral and proves possession for this fresh challenge; it is not a
hardware identity. The daemon key remains the trust root provisioned by the existing
trusted key configuration. Hardware-rooted key generation, anti-rollback anchoring, and
cross-host replication are separate deployment integrations.

## Verification

The Step 3 workflow runs the locked workspace format, check, test, and strict Clippy
suite, plus the existing Android platform-boundary check. The BPF build remains a
separate check inherited from Step 2. A dedicated native Linux qualification run is
still required to verify end-to-end kernel gating, real cgroup kill behavior, and
ring-buffer handshake behavior against the deployment kernel; CI compilation alone
does not prove that runtime security contract.
