# Step 3 worker bootstrap and daemon integration

## What is in this branch

- \`crates/klyn-sandbox/src/bin/klyn-worker-bootstrap.rs\`: trusted stage-zero launcher and PID-namespace-init worker. It does not execute model-supplied shell commands.
- \`crates/klyn-sandbox/src/namespace.rs\`: fail-closed user, mount, network, IPC, UTS and PID namespace operations.
- \`crates/klyn-sandbox/src/supervisor.rs\`: cgroup-v2-before-release launch gate and bounded worker pipe API.
- \`crates/klyn-sandbox/src/landlock_seccomp.rs\`: hard-required Landlock and restrictive seccomp profile.
- \`crates/klyn-sandbox/src/broker.rs\`: capability-verified Unix-socket broker; candidate file writes are forwarded into \`klyn-fs\`.
- \`crates/klyn-daemon/src/sandbox_service.rs\`: per-candidate OCap minting, private manifests, broker lifecycle, and worker manager.
- \`crates/klyn-daemon/src/bin/klyn-daemon.rs\`: fail-closed daemon startup/configuration and \`--worker-smoke\` mode.

The worker bootstrap accepts a small line-delimited JSON protocol (\`ping\`, \`read_file\`, \`write_candidate_file\`, \`shutdown\`). Arbitrary exec/fork is deliberately absent after seccomp is installed. The smoke mode checks that the worker reports \`getpid() == 1\` in its PID namespace and then aborts the disposable candidate transaction.

## Platform boundary

**Termux on Android can sync/edit this source, but it is not a supported native runtime for this sandbox.** The crate intentionally has a compile error for non-Linux targets. Even a Linux-looking Termux shell does not prove that Android's host kernel exposes unprivileged user/mount/PID namespaces, Landlock ABI v8, seccomp support and delegated cgroup v2.

Run the native tests and \`--worker-smoke\` on a dedicated Linux host or VM. Use a non-root service UID, a Linux kernel supporting the required primitives, a cgroup-v2 directory delegated to that service UID, and a clean Git checkout.

## Termux source sync

From Termux, run:

\`\`\`bash
pkg install git
curl -fsSL \
  https://raw.githubusercontent.com/usmanmuhd958-oss/klyn-ai/feat/klyn-step3-os-sandbox/scripts/klyn-step3-sync.sh \
  -o "$TMPDIR/klyn-step3-sync.sh"
bash "$TMPDIR/klyn-step3-sync.sh"
\`\`\`

The script targets \`~/klyn\`, refuses to overwrite local modifications, and detects Android so it does not claim that a native Linux sandbox test ran there.

## Linux configuration contract

Run the daemon as a dedicated, **non-root** account. All private JSON configuration files and the signing-key file must be owned by that account and have mode \`0600\`. The gate, broker, manifest and socket directories must be operator-owned and private. The filesystem engine refuses a dirty canonical checkout and requires its state directory to be outside the repository.

Required environment variables:

| Variable | Meaning |
|---|---|
| \`KLYN_REPOSITORY\` | Absolute path to the clean Git checkout |
| \`KLYN_FS_STATE_DIR\` | Absolute state directory outside that checkout |
| \`KLYN_PUBLICATION_REF\` | Optional publication ref; defaults to \`refs/heads/klyn-published\` |
| \`KLYN_DAEMON_SOCKET\` | Absolute Unix IPC socket path |
| \`KLYN_POLICY_FILE\` | Private policy JSON with explicit per-UID permissions |
| \`KLYN_SIGNING_KEY_FILE\` | Private file containing exactly 32 raw key bytes |
| \`KLYN_REVOCATION_FILE\` | Private JSON array of revoked token IDs; \`[]\` means none revoked |
| \`KLYN_SANDBOX_BOOTSTRAP\` | Absolute path to the built \`klyn-worker-bootstrap\` executable |
| \`KLYN_GATE_DIR\` | Private directory for worker start-gate FIFOs |
| \`KLYN_CGROUP_ROOT\` | Absolute path to a **real, delegated cgroup-v2 subtree** |
| \`KLYN_BROKER_DIR\` | Private directory for per-worker broker sockets |
| \`KLYN_MANIFEST_DIR\` | Private directory for signed capability and root manifests |

Optional controls: \`KLYN_SANDBOX_STARTUP_TIMEOUT_MS\` (default 5000), \`KLYN_BROKER_WORKERS\` (default 4), \`KLYN_BROKER_QUEUE_CAPACITY\` (default 16), \`KLYN_DRAIN_TIMEOUT_MS\` (default 5000).

Example policy file:

\`\`\`json
{
  "grants": [
    {
      "uid": 1000,
      "permissions": [
        "observe_daemon",
        "shutdown_daemon",
        "fs_begin_candidate",
        "fs_mutate_candidate",
        "fs_validate_candidate",
        "fs_publish_revision",
        "fs_abort_candidate"
      ]
    }
  ]
}
\`\`\`

Replace UID \`1000\` with the actual UID authorized to connect. Avoid giving publication or shutdown permission to untrusted users. An absent, unreadable, malformed or unsafe policy/revocation/key file prevents daemon startup or causes the broker authorization path to fail closed.

## Native Linux verification

From the repository root:

\`\`\`bash
cargo fmt --all -- --check
cargo test --package klyn-fs --package klyn-protocol --package klyn-daemon --package klyn-sandbox
cargo clippy --package klyn-fs --package klyn-protocol --package klyn-daemon --package klyn-sandbox --all-targets -- -D warnings
cargo build --release --package klyn-sandbox --bin klyn-worker-bootstrap --package klyn-daemon --bin klyn-daemon
\`\`\`

Create the policy, revocation list (\`[]\`), raw 32-byte signing key and the private runtime directories before starting. The cgroup root is not an ordinary directory: it must be a cgroup-v2 mount/subtree whose required controllers are available and enabled for child cgroups. Do not fabricate this prerequisite with regular files or \`chmod\`; arrange real delegation with the host's systemd/cgroup administration.

With all required variables set, run:

\`\`\`bash
./target/release/klyn-daemon --worker-smoke
\`\`\`

The smoke test intentionally fails on machines where required user/mount/PID namespaces, Landlock ABI v8, seccomp, broker connectivity, or cgroup-v2 controls are unavailable. A passing ordinary CI build does **not** substitute for this privileged Linux smoke test. The normal daemon mode listens on \`KLYN_DAEMON_SOCKET\`; worker launch is currently exposed as an in-process trusted runtime API, not a model-facing IPC method.

## Current verification boundary

The focused GitHub workflow runs formatting, targeted Rust tests and Clippy. It does not provision a privileged delegated cgroup-v2 subtree or prove every namespace/Landlock behavior on every target kernel. Keep the PR in draft until privileged Linux smoke tests and an OS-boundary review pass.
