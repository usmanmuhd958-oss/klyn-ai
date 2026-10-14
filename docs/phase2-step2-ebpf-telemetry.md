# Phase 2 / Step 2: eBPF telemetry and syscall-policy contract

## Runtime architecture

The worker receives a task selector inside the signed CapabilityClaims. HashJson and
DescribeJson compile to distinct syscall allowlists; a syscall outside those registered
task allowlists gets SECCOMP_RET_KILL_PROCESS. The seccomp architecture mismatch action
is also kill-process. Control remains the compatibility/control allowlist for broker-mediated operation; all
profiles terminate the process on any syscall outside their allowlists.

The optional eBPF object exports:
- events: a BPF ring buffer of fixed-layout klyn_event records;
- event_drops: a kernel-side counter for ring-buffer reserve failures, polled by the loader;
- target_cgroup_id: one-entry array map populated by the daemon loader;
- klyn_trace_sched_fork, klyn_trace_sched_exit, and klyn_trace_raw_sys_enter:
  tracepoint probes scoped by bpf_get_current_cgroup_id().

The daemon's WorkerTelemetry thread polls the ring buffer without blocking IPC, samples
cgroup-v2 memory.current, memory.max, cpu.stat, memory.stat, memory.events, pids.current,
pids.max, and io.stat, and reports metrics over a bounded channel. Threshold breaches
write 1 to the trusted worker cgroup.kill control file in the monitoring thread,
independent of whether the caller is reading telemetry events.

The eBPF path is optional; the cgroup-v2 monitor is mandatory. If KLYN_EBPF_OBJECT is
absent, libbpf cannot be loaded, BPF loading/attachment fails, or ring-buffer polling
fails, a CapabilityWarning is emitted and cgroup-v2 telemetry continues. Seccomp and
cgroup limits are not weakened in fallback mode. A trusted deployment must keep the
BPF ELF and all parent directories root-owned and non-writable.

## Building the BPF object

Requirements: a kernel with BTF at /sys/kernel/btf/vmlinux, clang with the BPF target,
bpftool, libbpf development headers, and target-architecture UAPI headers.

Example for x86-64 (choose the matching __TARGET_ARCH_* define for the target host):

    set -eu
    mkdir -p /tmp/klyn-bpf-build
    bpftool btf dump file /sys/kernel/btf/vmlinux format c > /tmp/klyn-bpf-build/vmlinux.h
    clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
      -I/tmp/klyn-bpf-build -I/usr/include/bpf -I/usr/include/x86_64-linux-gnu \
      -c crates/klyn-sandbox/ebpf/klyn_telemetry.bpf.c \
      -o /tmp/klyn-bpf-build/klyn_telemetry.bpf.o

The daemon loader opens, loads, attaches, and consumes the ring buffer itself. Install
the ELF at a root-owned, non-writable path such as /usr/lib/klyn/klyn_telemetry.bpf.o
and set KLYN_EBPF_OBJECT=/usr/lib/klyn/klyn_telemetry.bpf.o in the trusted daemon service
environment. Do not point it at a workspace-controlled object.

## Default anomaly thresholds

- Memory pressure: memory.current >= 98% of memory.max.
- OOM: any increase to cgroup memory.events oom or oom_kill.
- PID pressure: pids.current >= pids.max.
- Page-fault burst: 1,000,000 faults/second.
- Aggregate block I/O burst: 4 GiB/second.
- Fork/thread burst: 128 fork tracepoint events/second.

Thresholds can be set by the trusted daemon environment using
KLYN_TELEMETRY_INTERVAL_MS (50-5000), KLYN_MAX_PAGE_FAULTS_PER_SECOND,
KLYN_MAX_IO_BYTES_PER_SECOND, and KLYN_MAX_FORKS_PER_SECOND. Invalid configuration
is fatal to worker launch. Tune defaults against production workloads before enforcing
them on CPU/memory-heavy JSON operations.

## Verification boundary

The cgroup sampler has unit tests for strict metric parsing and anomaly rules. An
eBPF-capable native Linux job is still required to validate verifier acceptance,
tracepoint availability, ring-buffer delivery, worker-scoped filtering, cgroup teardown,
and syscall-kill behavior under the deployment kernel. Android/Termux should use the
explicit cgroup/seccomp fallback unless the vendor kernel and environment provide all
required features.
