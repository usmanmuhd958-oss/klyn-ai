# Phase 3 — Kani proofs and ephemeral QEMU/KVM qualification

## Formal verification boundary

The Kani verifier is pinned to release 0.68.0 by scripts/run_kani_proofs.sh. The proof suite targets pure invariant kernels used by production code:

- IPC: wrap-safe head/tail distance, rejection of impossible distances, fixed-capacity slot bounds, and FIFO/capacity properties over all producer/consumer choices in a finite 16-step SPSC trace.
- KEL: lifecycle transition admissibility, terminal-state rejection, sequence overflow, equality against an independently trusted predecessor root, and immutable candidate-chain updates.

These are bounded proofs of the listed kernels, not an unbounded proof of the whole sandbox. Kani does not model the actual OS thread or cross-process scheduling, shared mmap aliasing, or Release/Acquire behavior across separate processes. The IPC harnesses must not be reported as a data-race proof; the existing cross-thread/process ring tests remain necessary. Likewise, the KEL proofs do not establish SHA-256 collision resistance, Ed25519 correctness, filesystem durability, or OS key protection. The production chain verifier commits an immutable candidate head only after its canonical event hash and signatures have been verified.

The 16-step ring model is explicitly bounded with an explicit unwind bound of 20. KEL proofs use a default unwind bound of 100 to fully unwind Kani's byte-array comparison model; that does not turn the bounded proofs into claims about unbounded program executions. The harnesses are designed to prove their assertions with no accepted arithmetic wraparound and no unwinding assertion failure.

## Disposable native qualification VM

scripts/boot_qualification_vm.sh coordinates one disposable QEMU/KVM guest:

1. Fails closed unless KLYN_NATIVE_QUALIFICATION_READY is true, the host is x86_64 Linux, /dev/kvm is usable, and QEMU, qemu-img, SSH, tar and Python are installed.
2. Requires a root-owned, non-group/world-writable approved base disk image and a private SSH key with restrictive permissions.
3. Creates a temporary QCOW2 copy-on-write overlay, boots QEMU with KVM and loopback-only SSH forwarding, waits for the guest SSH server, and transfers the clean Git checkout into that guest.
4. Requires the approved guest image to contain root-owned, non-group/world-writable /etc/klyn/qualification.env. That file is a trusted image input and is never copied from the checked-out source. The guest qualification runs as an unprivileged user.
5. Only after establishing a connection to the live guest does the script set KLYN_NATIVE_EPHEMERAL_VM=true inside the guest and call scripts/orchestrate_native_qualification.sh. The strict orchestrator probes the live Landlock ABI (must be >= 8), delegated cgroup-v2 controllers and cgroup.kill, kernel BTF and the CO-RE eBPF ELF; then it runs the repository's strict workspace and end-to-end native checks.
6. Collects host QEMU serial output, guest qualification logs and guest evidence archive in KLYN_NATIVE_EVIDENCE_ROOT; kills QEMU and deletes its overlay and temporary working directory on exit.

A prepared base image remains a trust prerequisite. A launcher cannot safely invent the daemon signing identity, root-owned public key, policy, revocation state, trusted worker and sandbox-init executables, read-only root, broker directory, delegated cgroup subtree, or compiled CO-RE BPF object. Build and review the image independently, then keep it root-owned and non-writable by the runner account. The image must use a kernel that actually provides Landlock ABI v8 or newer, cgroup v2 with cpu/memory/pids controllers and cgroup.kill, and BTF. The script verifies those requirements live and fails on a mismatch; it never enables a false positive.

## Runner configuration

Install qemu-system-x86, qemu-utils, OpenSSH client, tar, Python 3, coreutils and access to /dev/kvm on a dedicated runner tagged klyn-kvm-qualification. Use a dedicated ephemeral runner and require environment approval for the native job; protect the image path, image digest and VM SSH secret from untrusted branches. Prepare a supported x86_64 guest image and configure:

- GitHub Actions variable KLYN_NATIVE_QUALIFICATION_READY=true.
- GitHub Actions variable KLYN_VM_BASE_IMAGE containing the absolute runner-local path to the root-owned approved image, and KLYN_VM_BASE_IMAGE_SHA256 containing its lowercase or uppercase SHA-256 digest.
- GitHub Actions variable KLYN_VM_SSH_USER (optional; default klyn-qualifier).
- GitHub Actions secret KLYN_VM_SSH_PRIVATE_KEY whose matching public key is already in that guest account's authorized_keys.
- GitLab CI variables KLYN_NATIVE_QUALIFICATION_READY=true, KLYN_VM_BASE_IMAGE, KLYN_VM_BASE_IMAGE_SHA256 and KLYN_VM_SSH_KEY as a file-type variable. KLYN_VM_SSH_USER is optional.
- In the approved guest image, root-owned /etc/klyn/qualification.env must define the strict orchestrator's trusted paths: KLYN_TEST_CGROUP_ROOT, KLYN_CGROUP_ROOT, KLYN_FS_STATE_DIR, KLYN_DAEMON_SOCKET, KLYN_POLICY_FILE, KLYN_SIGNING_KEY_FILE, KLYN_REVOCATION_FILE, KLYN_SANDBOX_INIT, KLYN_WORKER_EXECUTABLE, KLYN_READ_ONLY_ROOT, KLYN_BROKER_DIR and KLYN_EBPF_OBJECT. Also provision /etc/klyn/ocap-ed25519.pub and required tools such as bpftool and a C compiler.

The Phase 3 GitHub native job runs only on explicit workflow dispatch with the native input enabled and the readiness variable true. GitLab schedules the VM job automatically when readiness is true on matching merge requests or the Phase 3 feature branch. A green ordinary CI run still says native qualification was not requested; it is not evidence of live kernel enforcement.

## Commands

    cargo fmt --all -- --check
    cargo metadata --locked --format-version 1
    cargo check --locked --workspace --all-targets
    cargo test --locked --workspace
    cargo clippy --locked --workspace --all-targets -- -D warnings
    bash scripts/run_kani_proofs.sh

For a configured runner, set KLYN_NATIVE_QUALIFICATION_READY=true, KLYN_VM_BASE_IMAGE=/absolute/path/to/approved-base.qcow2 and KLYN_VM_SSH_KEY=/absolute/path/to/private-key, then run bash scripts/boot_qualification_vm.sh. Do not set KLYN_NATIVE_EPHEMERAL_VM=true on a host; only the microVM script sets it inside the live guest.
