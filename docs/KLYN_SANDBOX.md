# KLYN OS Native Sandbox and Resource Broker

## Scope and trust boundary

The klyn-sandbox crate supplies Linux-native enforcement primitives used by the OCap v1 runtime. It is part of the trusted computing base, along with the launcher, signing-key registry, current-policy gate, durable revocation/quota adapters, KEL evidence appender, and registered resource table. Agent code, tool arguments, prompts, file content, and network responses are untrusted.

The crate fails closed if Landlock, seccomp, required cgroup-v2 controller files, trusted signing keys, revocation state, policy state, quota reservations, or a KEL authorization receipt are unavailable. A scope or a successful token verification alone does not make a process sandboxed.

Linux reference documentation:
- Landlock userspace API: https://docs.kernel.org/userspace-api/landlock.html
- Seccomp filter: https://docs.kernel.org/userspace-api/seccomp_filter.html
- cgroup v2: https://docs.kernel.org/admin-guide/cgroup-v2.html

## Normative invocation sequence

1. Authenticate the Unix peer using SO_PEERCRED and map its UID to a configured principal.
2. Validate the request envelope and size; require the exact protocol schema.
3. Verify the complete OCap token using canonical JCS bytes and Ed25519, with a trusted key-to-issuer binding. Check subject, mission, audience, not-before, expiry, resource scope, operation set, and the SHA-256 digest of canonical request fields.
4. Ask the policy adapter for the current mission/tenant decision; consult durable revocation state, including parent/ancestor revocations; atomically reserve invocation and concurrent quota.
5. Construct the runtime's pre-execution attestation over token/request/scope/policy/sandbox digests, runtime identity, mission, deadline, and quota reservation. Verify the returned collector signature against the trusted key registry.
6. Append the authorization event, including the complete signed attestation, through a KEL adapter. The adapter must return only after durable KEL acceptance and configured verification.
7. Recheck revocation immediately before resource dispatch. Only now resolve/open a resource, perform deletion, connect to a network peer, or call a configured isolated native-operation provider.
8. Pass any resulting capability FD with SCM_RIGHTS. Append completion/failure evidence and finalize quota after synchronous work finishes or the bounded proxy completes.

If authorization evidence cannot be committed, no filesystem mutation, TCP connect, process launch, or descriptor grant occurs. If resource dispatch fails after authorization was recorded, a failure event is appended and quota is not refunded.

## Linux isolation primitives

### Namespaces

enter_namespaces_for_next_child must be called from a disposable, single-purpose launcher process, not from the shared daemon service. It creates a user namespace and writes single-ID UID/GID maps, creates mount/network/IPC/UTS namespaces, makes mounts recursively private, and requests a PID namespace. Linux applies CLONE_NEWPID to future children, so the launcher must fork the final worker next. The final worker, not the long-lived daemon, must receive the restricted root and broker IPC descriptor.

This function does not hide the extra fork requirement behind an unsafe in-process Command callback. Integrators must run this from a dedicated launch helper, propagate setup failures to the parent, and never release the worker's exec gate until namespaces, cgroups, mounts, Landlock, seccomp, UID/GID state, rlimits, and descriptor closure have succeeded.

### Landlock

open_scoped_directory uses openat2 with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS against an already-registered root descriptor. A token's relative subtree is resolved against that root; it is not interpreted as an absolute host path. scope_landlock_rule maps only the granted filesystem operations to Landlock rights. apply_landlock_rules sets PR_SET_NO_NEW_PRIVS, creates the ruleset, adds explicit directory rules, and restricts the current worker.

All access rights handled by the detected ABI are denied by default except rights explicitly granted to an approved directory. Write-capable scopes require ABI v3 or later because earlier ABIs cannot mediate truncation safely. Unknown/disabled Landlock is an error, not a request to run without a filter.

Landlock cannot fully mediate metadata calls such as every stat-like operation. fs.metadata therefore remains a broker-mediated operation; the worker does not receive a general host path API. Runtime baseline directories (libraries, certificates, etc.) must be separately opened and explicitly added to the Landlock policy with only required read/execute rights. Do not add / as a general baseline root.

### seccomp-BPF

seccomp_program checks the native audit architecture first and kills a mismatched architecture. The profile returns EPERM for raw open/openat/openat2, socket creation/connect/bind/listen/accept, execve/execveat, fork/clone, mount/pivot/chroot, namespace changes, ptrace, BPF/perf, userfaultfd, io_uring, and common filesystem mutation syscalls. The program returns allow only after all deny checks have failed. install_agent_seccomp sets PR_SET_NO_NEW_PRIVS before installing the filter.

The agent is expected to use inherited stdio and a pre-opened Unix broker channel. The launcher must close all other inherited descriptors. A passed descriptor is a capability; do not pass an unrestricted daemon socket, host directory FD, raw TCP connection, or unrelated credential-bearing FD. Seccomp reduces syscall surface but is not a standalone sandbox.

### cgroup v2 and CPU/memory/I/O budgets

CgroupV2::create requires a host-delegated cgroup v2 subtree and real controller files. It sets memory.max, disables swap with memory.swap.max=0, restricts CPU rate via cpu.max, caps task count with pids.max, and applies io.max only where explicit device major/minor and BPS/IOPS limits have been configured. A missing control file is a hard failure; it is never synthesized as a regular file.

maxCpuMsPerInvocation is a cumulative CPU-time budget, not a CPU rate. The supervisor must poll cpu.stat and call enforce_cpu_budget; exceeding the time ceiling triggers cgroup.kill. To avoid a launch race, create and configure the cgroup first, have the child block on a launch gate, write its PID to cgroup.procs, then release the gate. Calling attach_paused_pid after untrusted execution begins is too late.

maxOutputBytes is an output-metering ceiling, not a block-I/O ceiling. File/device I/O is constrained using explicit CgroupIoLimit configuration; the two are not conflated.

## Native resource broker

### Wire protocol

The server binds only below an owner-controlled directory with mode 0700, sets the Unix socket to 0600, refuses to replace regular files or symlinks, verifies peer UID using SO_PEERCRED, and allows one framed request per connection.

The frame is a 4-byte unsigned big-endian length followed by UTF-8 JSON, maximum 1 MiB. The request body contains:
- schema: urn:klyn:resource-broker-request:v1
- invocation: the OCap v1 CapabilityInvocationRequest shape.

The response is a similarly framed urn:klyn:resource-broker-response:v1 JSON object. If fdCount is 1, the message includes exactly one descriptor sent with SCM_RIGHTS. A partial sendmsg, malformed frame, unexpected ancillary message, unknown selector field, or invalid descriptor count is a protocol failure. The client must reject the response if the response schema, invocation ID, token/request digest, attestation, or evidence receipt does not match its outstanding request.

### File access and byte ceilings

The resource registry holds broker-owned directory FDs keyed by immutable handleId and resourceId. File opens use openat2 relative to that root and deny .., symlinks, magic links, absolute paths, and unknown selectors. Read requests return a sealed memfd snapshot capped by the requested and scope byte ceilings. Directory listings are copied to a bounded snapshot. Metadata requests receive only an O_PATH descriptor. Writes/creates receive a pipe FD; a broker worker copies from the pipe to the target file up to the exact byte quota, then closes it and records any violation. Delete operations resolve the parent directory beneath the root and use unlinkat; no user path is concatenated with a privileged root.

No raw target-file descriptor is passed for ordinary reads/writes, which would let a recipient ignore a user-space byte counter. The read snapshot is sealed against further writes. For fs.write/fs.create, overflow fails the background stream and records a failed operation; clients must treat a broken pipe or failed completion record as operation failure.

### Network mediation

The worker's seccomp profile denies raw socket creation and connect. The broker resolves the exact hostname/port once, applies NetworkAddressPolicy to each candidate resolved address, and connects to the selected SocketAddr without re-resolving. The agent receives one side of a Unix socketpair; the broker forwards to/from the TCP stream and enforces a shared byte ceiling across both directions. This prevents the worker from getting an unmetered raw TCP socket. The host must configure NetworkAddressPolicy; it has no permissive default and should explicitly decide which private, loopback, link-local, or metadata destinations can be reached.

### Process, memory and IPC operations

Process/memory/IPC requests are verified against token scopes before reaching NativeOperationProvider. The provider is an explicit trusted launch integration. For process operations it must create an independently isolated child, re-validate executable SHA-256 and argv prefix, clear the ambient environment, set its own namespaces/Landlock/seccomp/cgroup, and attach before releasing exec. If no provider is configured, the broker denies the request. The crate does not silently fall back to std::process::Command in the authority process.

## Conformance tests

crates/klyn-sandbox/tests/kernel_enforcement.rs launches disposable child test processes to check:
- a granted Landlock subtree is readable while an out-of-scope path is denied;
- seccomp rejects direct socket creation and direct path open;
- openat2 rejects a symlink escape from the registered subtree.

Unit tests also check token parsing/signature verification, scope validation, syscall filter construction, byte-budget handling, framed messages, peer credentials, and SCM_RIGHTS descriptor transfer.

## Deployment qualification

Before production enablement, implement and review host-specific adapters for CapabilityKeyResolver, RevocationChecker, InvocationQuotaStore, CapabilityPolicyGate, RuntimeAttestor, CapabilityEvidenceAppender, PeerPrincipalResolver, NetworkAddressPolicy, and NativeOperationProvider. Verify those adapters against the actual KEL daemon and durable storage; run race tests around revocation/quota admission; qualify kernel ABI/version/architecture support; fuzz framed JSON and ancillary-data handling; test cgroup controller delegation and crash cleanup; and run the kernel suite on the supported deployment kernel matrix.

This repository's CI is evidence of tested code paths, not a substitute for an independent security audit or live-host qualification.
