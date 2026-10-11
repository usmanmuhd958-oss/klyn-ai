# KLYN OS sandbox enforcement architecture

## Security contract

The native sandbox is a Linux-only enforcement layer for agent tasks. Its fail-closed contract is:

1. No worker is released from the start gate before its cgroup membership is written.
2. No namespace, UID/GID transition, trusted executable validation, manifest seal, Landlock rule, or seccomp install may silently fall back to a weaker mode.
3. No broker operation is performed before signature validation, claim validation, expiry validation, peer UID/GID matching, and a successful KEL revocation lookup.
4. No general process execution is exposed through the broker.
5. A kernel policy installation error is fatal. The worker bootstrap caller must terminate immediately and must never execute task code after an error.

This protects against hostile or compromised agent-task code under the assumption that the Linux kernel, KLYN daemon, trusted worker bootstrap, stage-0 helper, OCap signing authority, and KEL authority are not compromised. It is not a defense against a malicious host root or a kernel vulnerability.

## Execution lifecycle

1. The daemon verifies the OCap signature, validates the resource budget and grants, checks token expiry, and queries KEL.
2. It canonicalizes trusted filesystem roots and writes the signed capability into a memfd-backed manifest.
3. The manifest is sealed with F_SEAL_WRITE, F_SEAL_SHRINK, F_SEAL_GROW, and F_SEAL_SEAL.
4. The daemon creates a dedicated cgroup-v2 subtree and applies memory, swap, CPU, PID, and optional per-device I/O controls.
5. The daemon starts the trusted klyn-sandbox-init helper with the sealed manifest and a start gate. It waits for helper startup to block on the gate, attaches the helper PID to the cgroup, then releases the gate.
6. The helper unshares mount, network, IPC, UTS and PID namespaces, makes mount propagation private, forks into the new PID namespace, mounts a private procfs, clears supplementary groups, sets the signed GID and UID, sets a restrictive umask, disables dumpability, sets no_new_privs, closes unneeded file descriptors, and execs the configured trusted worker without a shell.
7. The native worker calls bootstrap_worker before interpreting an agent instruction. It reads and verifies the sealed manifest, connects to the broker as its dropped UID/GID, verifies broker SO_PEERCRED against the socket owner recorded in the manifest, closes the manifest FD, and installs Landlock followed by seccomp.
8. The broker checks every request independently. For file opens it checks the exact root ID, component-aware subtree scope and access mode, then performs openat2 relative to a pinned directory FD with BENEATH, NO_SYMLINKS, NO_MAGICLINKS and NO_XDEV. For TCP, it allows only a literal IP:port exact grant. It returns one descriptor through SCM_RIGHTS only after authorization.
9. The seccomp profile denies direct path-opening syscalls, socket creation, connect, process creation/execution, sendmsg, io_uring, ptrace, mount and other syscalls not explicitly allowed. recvmsg is allowed only when its first argument is FD 3.

## OCap and KEL contract

The crate defines CapabilityVerifier and RevocationOracle traits so the existing TypeScript OCap v1 and KEL v1 implementation can be connected without treating caller-provided claims as trusted data.

The built-in Ed25519CapabilityVerifier signs/verifies deterministic JSON generated from the claims value with recursively sorted object keys. The TypeScript signer must use precisely the same byte encoding. If the existing OCap implementation uses a different canonical JSON, CBOR, digest, domain separator, or envelope format, implement CapabilityVerifier against that exact protocol; do not accept signatures that merely parse or whose payload serialization is assumed to match.

The KEL adapter must implement is_revoked as an authenticated, bounded-time query. A KEL outage or malformed response denies the request. This crate checks KEL before every descriptor grant, but an already-issued file or socket FD cannot be revoked by changing the token status. If revocation semantics require immediate termination, the KEL adapter must trigger cgroup.kill for the corresponding task and the execution controller must treat that task as terminated. Descriptor brokering alone cannot retract an FD already installed in another process.

## File and network semantics

File grants identify a configured root and a relative path prefix. Paths with absolute components, empty path components, dot components, parent traversal, NUL bytes, backslashes or symlink traversal are rejected. The broker opens existing files only; it does not create files or truncate them. Write access means write access to an existing object within the signed subtree. The worker cannot open arbitrary paths after seccomp is active; it must use broker-issued descriptors.

Network grants are literal socket addresses and do not accept hostnames, which avoids DNS rebinding. Only TCP is currently brokered. A granted socket is already connected to its signed endpoint. No arbitrary UDP, raw socket, bind, listen, accept or arbitrary connect operation is available through the worker profile. Process execution requests are explicitly denied by the broker; task creation is a daemon-controlled launch operation, not a worker-controlled broker action.

## Kernel and host prerequisites

- Linux with Landlock ABI v8 or later, because the implementation hard-requires all-thread enforcement. Unsupported Landlock features stop launch.
- seccomp-BPF with TSYNC support and a supported architecture for seccompiler.
- openat2 support with RESOLVE_BENEATH, RESOLVE_NO_MAGICLINKS, RESOLVE_NO_SYMLINKS and RESOLVE_NO_XDEV; no fallback to openat is permitted.
- A cgroup-v2 delegated subtree exposing cpu, memory and pids, plus io when I/O limits are requested. The parent must enable the relevant subtree controllers before launch.
- Privileges sufficient for mount, network, IPC, UTS and PID namespace creation. Failure to unshare any required namespace stops the worker.
- A daemon-owned, trusted directory for the Unix socket. The socket is mode 0666 so different signed worker UIDs can connect; security depends on the protected parent directory, kernel SO_PEERCRED, token signatures and per-request KEL checks. The bounded queue and socket timeouts reduce resource exhaustion, but deployments exposed to many mutually untrusted local users should additionally use a dedicated group or per-tenant socket and apply connection/rate limits.
- A root-owned or daemon-owned stage-0 helper and worker binary, with no group/world writable executable or ancestor directory.

Useful upstream references: [Landlock Rust API](https://docs.rs/landlock/0.4.7/landlock/), [seccompiler Rust API](https://docs.rs/seccompiler/0.5.0/seccompiler/), [nix SCM_RIGHTS API](https://docs.rs/nix/0.30.1/nix/sys/socket/fn.sendmsg.html), and [Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html).

## Validation and deployment gate

Run these commands on a Linux CI runner with required kernel support:

- cargo fmt --manifest-path crates/klyn-sandbox/Cargo.toml -- --check
- cargo test -p klyn-sandbox
- cargo clippy -p klyn-sandbox --all-targets

The integration probe runs in a child process because a successful seccomp install is intentionally irreversible for that process. It verifies that an out-of-scope path is denied by Landlock, non-broker recvmsg is rejected, new sockets and connect are denied, and execve is denied. Unit tests additionally cover component-aware path scope, traversal, symlink rejection through openat2, signature tampering, revocation-oracle failure, and budget validation.

Before production release, the TypeScript OCap signer and the Rust verifier must pass cross-language golden-vector tests for the exact capability bytes and signatures. The KEL adapter also requires integration tests against the production revocation consistency model. CI compilation and local unit tests are necessary but are not a substitute for host-level adversarial testing and an independent security review.
