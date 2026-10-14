# Shared-memory SPSC IPC ring: Step 1 checkpoint

## Scope

This checkpoint replaces the supervisor/worker **control-message data path** with two bounded single-producer/single-consumer (SPSC) rings. It does not replace the resource broker: capability-mediated filesystem/network access still travels through the existing AF_UNIX broker, whose authorization and descriptor-transfer checks remain in force.

The command vocabulary deliberately remains limited to `ping` and `shutdown`. This is a transport checkpoint, not permission to add arbitrary execution RPCs or expose the candidate worktree.

## Topology

```text
                    supervisor / daemon                    worker (PID namespace)

  COMMAND RING
  payload memfd    RW  ------------------------------->  RO
  head counter     RW  ------------------------------->  RO
  tail counter     RO  <-------------------------------  RW

  RESPONSE RING
  payload memfd    RO  <-------------------------------  RW
  head counter     RO  <-------------------------------  RW
  tail counter     RW  ------------------------------->  RO

  Descriptor ABI inherited by the trusted launcher:
    FD 4  signed, sealed worker manifest
    FD 5  stage-0 cgroup-attachment release gate
    FD 6  post-Landlock/seccomp mission-release gate
    FDs 7..9   worker command-ring endpoint
    FDs 10..12 worker response-ring endpoint

  AF_UNIX broker channel (separate):
    worker -- capability verification / revocation / SCM_RIGHTS --> resource broker
```

Each ring contains 8 fixed slots. Each slot reserves 64 KiB for a payload and a bounded length prefix. The counter files are separate page-sized memfds; the endpoint receives only the access mode required by its role. Memfd size seals prevent accidental resize after geometry has been established. Shared futex waits/wakes are used for bounded waits without a helper thread or a per-message syscall through a socket.

## Memory-order and ownership contract

The producer is the sole writer of its `head` counter and payload slots. It writes the length and payload completely, then publishes `head + 1` using Release. The consumer reads `head` using Acquire, verifies that the distance from `tail` is no greater than the ring capacity, validates the payload length, and reads the slot before publishing `tail + 1` with Release. Before reusing a slot, the producer reads the consumer tail using Acquire.

The ring API is mutable-owner based: an endpoint is not `Sync`, operations take `&mut self`, and a reservation holds that exclusive borrow until committed/consumed. The normal worker loop uses fixed opcodes and stack storage; it does not JSON-serialize messages, allocate a payload buffer, or copy across a kernel socket boundary. The producer API also exposes a reserved shared slot through `ProducerReservation::buffer()` for encoding directly into shared storage. The convenience `try_push` and daemon JSON-compatibility adapter do copy/allocate at their API boundary, so **do not use those wrappers to claim every caller is allocation-free**.

## Startup and failure handling

Rings are created only after the supervisor validates the signed manifest and OCap. The worker maps the inherited descriptors only after independently verifying the sealed manifest, its executable digest, the capability signature, and the capability subject. The existing start gate and policy-ready gate remain mandatory: the supervisor attaches the stage-0 process to the cgroup and reads back limits before gate 5 is released, and it waits for the worker to confirm Landlock/seccomp before releasing mission gate 6.

Unknown opcodes, malformed response frames, impossible head/tail distances, invalid lengths, futex errors, and bounded supervisor-side IPC timeouts return errors. Supervisor-side protocol failures invoke cgroup termination; the worker entry point exits fail-closed on malformed input or transport failure. `Drop` continues to target the cgroup instead of assuming killing the direct child is sufficient.

## Unsafe review ledger

| Site | Required invariant |
| --- | --- |
| `Mapping::new` / `Drop` | `mmap` succeeds before a `Mapping` is constructed; pointer and length are retained together; `munmap` runs exactly once. Mappings own virtual mappings independently of backing-fd lifetimes. |
| Counter initialization | `AtomicU32` objects are written only into newly created, exclusively owned, sealed-size memfds before an endpoint is shared. Attached endpoints do not reinitialize counters. |
| Atomic pointer dereferences | Counter pointers target retained, page-aligned mappings with the intended read/write access; producer and consumer ownership rules restrict writers. |
| Slot pointer arithmetic / slices | Capacity is a compile-time power of two; the index is masked by capacity; each slot starts on a 64-byte boundary; lengths are checked before constructing a payload slice. |
| Inherited descriptor ownership | The caller supplies the fixed, distinct, open descriptors from the trusted launcher; each constructor takes ownership exactly once with `OwnedFd`; mapping and file-size/seal checks run before use. |
| `Send` implementations | Moving an endpoint transfers sole ownership of its mutable operation state and mapping objects. The endpoints are intentionally not `Sync`; their safety depends on the SPSC role contract. |
| `futex` syscalls | The address refers to a retained, aligned shared `AtomicU32` mapping; wait/wake use process-shared operations (no private-futex flag) and never retain userspace pointers in the kernel. |

These invariants protect the trusted endpoints against invalid geometry and malformed frames; shared memory is not a substitute for capability validation and is not a security boundary against arbitrary native code already running inside an endpoint. The worker's output is always treated as untrusted, and the manifest, OCap, broker checks, Landlock, seccomp, cgroup, and supervisor gates remain the security authority.

## Checkpoint tests

The ring module includes bounded-capacity/recovery, payload length checks, both attachment directions, an empty-ring timeout check, an isolated subprocess round-trip over inherited memfds, and an ordered 20,000-frame producer/consumer stress test. The supervisor's binary response parser tests valid control frames and rejects unknown opcodes, invalid lengths, invalid flags, and unexpected trailing bytes.

Required CI gate for this branch:

```bash
cargo fmt --all -- --check
cargo metadata --locked --format-version 1
RUSTFLAGS="-D warnings" cargo check --locked --workspace --all-targets
cargo test --locked --workspace -- --nocapture
cargo clippy --locked --workspace --all-targets -- -D warnings
```

A hosted green run is not native kernel qualification. Run `scripts/qualify-native-linux.sh` on the dedicated ephemeral host before treating cgroup/Landlock/seccomp deployment as certified.

## Explicitly not in this checkpoint

- eBPF syscall/resource telemetry loader and BPF program verification
- KEL-bound dispatch, policy decision, lifecycle and outcome events
- hardware-rooted attestation or TPM/TEE key binding
- transactional filesystem rollback coordinated with worker cgroup teardown
- cross-process fuzzing or a separate privileged adversarial fault-injection job

These remain later checkpoints. Do not describe them as implemented or certified by the SPSC transport change.
