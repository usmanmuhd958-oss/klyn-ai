# Phase 2 Step 5 — Adversarial fuzzing and native Linux qualification

## Fuzz targets

The cargo-fuzz package is deliberately isolated from the root workspace lockfile at:

- `crates/klyn-sandbox/fuzz/fuzz_targets/fuzz_ipc_frame.rs`: exercises the length-prefixed IPC frame parser and the binary worker-response control parser.
- `crates/klyn-sandbox/fuzz/fuzz_targets/fuzz_kel_parser.rs`: exercises the fixed-width KEL decoder, lifecycle/sequence rules, hash chaining, daemon signatures, worker-lineage checks, terminal destruction ordering, and external expected-head validation.

The campaign caps each IPC input at 64 KiB plus the prefix and each KEL chain at 32 records to bound per-input work. The fuzzer treats parser errors as expected results; crashes, sanitizer findings, or timeouts are failures.

Install cargo-fuzz with a nightly toolchain, then run:

```bash
cargo +nightly install cargo-fuzz --locked
RUSTUP_TOOLCHAIN=nightly bash scripts/run_fuzz_campaign.sh
```

The default campaign executes 1,000,000 iterations for each target. Set `KLYN_FUZZ_RUNS` to a smaller count for a smoke run. The workflow compiles both targets on each applicable branch/PR; the million-iteration campaign is opt-in through workflow dispatch.

## Adversarial tests

`crates/klyn-sandbox/tests/adversarial_protocol.rs` checks malformed IPC lengths and control frames, invalid lifecycle transitions, corrupted KEL signatures, and an attestation response replayed against a different nonce. `fs_txn_rollback.rs` from Step 4 continues to test forced-process termination and removal of the disposable workspace.

## Native qualification host

The native run must execute on an **ephemeral, dedicated Linux VM**, as a non-root daemon identity with delegated cgroup-v2 controls and the capabilities required by the deployment's BPF policy. It must not run against a developer's live host state. The native runner requires a clean disposable Git checkout, a clean/empty filesystem-transaction test area, a fresh publication ref, and pre-provisioned trusted daemon assets.

Required environment variables inherited by the self-hosted runner:

- `KLYN_TEST_CGROUP_ROOT` and `KLYN_CGROUP_ROOT`: the same writable delegated cgroup-v2 directory with cpu, memory, and pids enabled and `cgroup.kill` available.
- `KLYN_EBPF_OBJECT`: readable, precompiled CO-RE eBPF object matching the qualification host's architecture/kernel.
- `KLYN_REPOSITORY`, `KLYN_FS_STATE_DIR`: a disposable clean checkout and absent/empty transaction state.
- `KLYN_DAEMON_SOCKET`, `KLYN_POLICY_FILE`, `KLYN_SIGNING_KEY_FILE`, `KLYN_REVOCATION_FILE`, `KLYN_SANDBOX_INIT`, `KLYN_WORKER_EXECUTABLE`, `KLYN_READ_ONLY_ROOT`, and `KLYN_BROKER_DIR`: trusted deployment-specific fixtures for the existing daemon smoke test.
- Optionally `KLYN_PUBLICATION_REF`: the ref checked for freshness; defaults to `refs/heads/klyn-published`.

Run from the checkout root:

```bash
bash scripts/qualify_native_linux.sh
```

The wrapper invokes the reviewed `scripts/qualify-native-linux.sh` implementation. Qualification sets `KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION=1`, so the cgroup-v2 membership/kill test and Landlock ABI test fail instead of silently skipping. The native eBPF integration test also requires `KLYN_EBPF_OBJECT`, demands `TelemetryMode::EbpfRingBuffer` rather than cgroup-only fallback, starts a gated child inside a disposable cgroup, and requires a cgroup-filtered process-fork event to arrive through the ring buffer. The test then stops telemetry and kills/waits for the cgroup.

## Evidence and limits

The suite can establish parser robustness for exercised byte streams, cryptographic/state-machine rejection behavior, and the observed runtime behavior on the specific qualification kernel/configuration. It cannot mathematically prove the absence of all bugs or all race conditions. A successful result must be recorded with the commit SHA, kernel version, Landlock ABI, cgroup controller state, BPF object digest, verifier/load result, event-delivery result, and workspace CI run links.

Native qualification is opt-in. A green workspace CI run or successful BPF object compilation alone is **not** a certification of live cgroup kill, Landlock ABI v8, Seccomp-BPF enforcement, or eBPF ring-buffer delivery.
