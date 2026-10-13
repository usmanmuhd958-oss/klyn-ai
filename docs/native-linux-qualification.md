# Native Linux sandbox qualification

This procedure is the mandatory Phase 1 gate for the Step 3 worker bootstrap. An ordinary workspace test pass is not native qualification: without the qualification flag, the delegated-cgroup probe may intentionally skip and an older kernel may exercise only Landlock's fail-closed path.

## Security boundary

Run this on a dedicated, disposable Linux VM or an ephemeral self-hosted CI runner. Do not expose long-lived secrets to the runner, and do not execute the opt-in workflow against an unreviewed branch. The runner must be labeled `klyn-native-qualification`.

The process running the script must be a dedicated non-root KLYN daemon identity. It must have a writable delegated cgroup-v2 subtree with `cpu`, `memory`, and `pids` controllers available and enabled, and the kernel must provide `cgroup.kill` and Landlock ABI v8 or newer. The trusted `klyn-sandbox-init` installation must have the narrowly reviewed privilege needed for namespace setup; do not run `klyn-daemon` as root or silently remove a failed isolation stage.

The trusted helper and worker must be installed beneath root-owned, non-group/world-writable directories. The helper must be named `klyn-sandbox-init`; the worker must be named `klyn-worker`. Their installed bytes must match the binaries built from this checkout. The fixed verification-key file `/etc/klyn/ocap-ed25519.pub` must be a root-owned, non-group/world-writable regular file containing exactly 32 raw Ed25519 public-key bytes corresponding to the daemon's signing key.

## Runtime configuration

Before running the script, configure these variables in the dedicated runner service environment (or export them in the invoking shell). All paths must be absolute.

- `KLYN_TEST_CGROUP_ROOT` and `KLYN_CGROUP_ROOT`: the same writable delegated cgroup-v2 child subtree, not the cgroup mount root.
- `KLYN_REPOSITORY`: a fresh disposable clean Git clone. The selected publication ref must not already exist.
- `KLYN_FS_STATE_DIR`: absent or empty transaction-state directory outside the repository.
- `KLYN_DAEMON_SOCKET`: absolute socket path reserved for this qualification instance.
- `KLYN_POLICY_FILE`: daemon-owned private JSON policy granting the current UID at least `fs_begin_candidate` and `fs_abort_candidate`.
- `KLYN_SIGNING_KEY_FILE`: daemon-owned private file containing the 32 raw bytes of the Ed25519 signing seed.
- `KLYN_REVOCATION_FILE`: daemon-owned private valid JSON array (use `[]` for an empty test revocation set).
- `KLYN_SANDBOX_INIT` and `KLYN_WORKER_EXECUTABLE`: root-controlled installed native ELFs matching this build.
- `KLYN_READ_ONLY_ROOT`: a separately provisioned root-owned non-writable runtime directory; do not point it at the live candidate or repository.
- `KLYN_BROKER_DIR`: an absent or private directory path the daemon identity can own.

The daemon config readers require their private JSON/key files to be owned by the daemon UID with no group/other permission bits. The signing seed and public verification key must be a matching pair. The script intentionally refuses to reuse a populated transaction state directory or an existing publication ref.

The delegated cgroup subtree and privileged launcher must be provisioned by the host administrator using the host's service manager and reviewed privilege policy. Do not enable cgroup controllers on the host root or grant broad ambient capabilities to the daemon as a shortcut.

## Run Phase 1

From the repository root, as the configured non-root daemon identity:

```bash
scripts/qualify-native-linux.sh
```

The script fails if it is not running on Linux, if the cgroup root/controllers are missing, if the test would skip the real cgroup attachment probe, if Landlock ABI v8+ is unavailable, if warnings/tests/Clippy fail, if the installed trusted binaries do not match the current build, or if `klyn-daemon --worker-smoke` cannot complete the real bootstrap and shutdown lifecycle.

The real worker smoke test verifies the end-to-end start gate, namespace-init PID, trusted stage-0 bootstrap, cgroup boundary, signed manifest and capability, Landlock, seccomp, broker setup, mission release, and worker shutdown. The in-crate Landlock/seccomp child tests separately assert that prohibited operations are rejected. Logs must be retained with the kernel/toolchain identity and exact commit SHA.

## CI dispatch and pre-merge gate

For the pre-merge qualification of this draft PR, run `scripts/qualify-native-linux.sh` directly on the dedicated ephemeral host and attach the full log to the PR. GitHub only makes `workflow_dispatch` available after the workflow definition is present on the repository's default branch, so the opt-in self-hosted job may not be dispatchable before that point.

Once this workflow version exists on the default branch, invoke **KLYN Rust Sandbox and Worker Bootstrap** with `run_native_linux_qualification=true` while selecting the reviewed `reconcile/step3-platform-daemon` branch. The job intentionally remains queued if no runner with the required label is registered; do not interpret that as a pass.

## Phase gate

Phase 1 is accepted only when the required native job completes successfully on the exact candidate commit and its logs are retained. A regular hosted run in which privileged probes skip is not acceptable evidence. Keep the reconciliation PR in draft until this gate passes. RuntimeLease/OCap unification and mandatory KEL evidence integration are subsequent phases; they must not be represented as complete by this qualification procedure.
