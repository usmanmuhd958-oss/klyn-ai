// KLYN worker-scoped kernel telemetry.
// Build as a BPF ELF with CO-RE headers; this file is not compiled by Cargo.
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <asm/unistd.h>

#define KLYN_EVENT_FORK 1
#define KLYN_EVENT_EXIT 2
#define KLYN_EVENT_SENSITIVE_SYSCALL 3
#define KLYN_TASK_COMM_LEN 16

struct klyn_event {
    __u64 timestamp_ns;
    __u64 cgroup_id;
    __u32 pid;
    __u32 tgid;
    __u32 kind;
    __s32 syscall_nr;
    __u64 value;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 20);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} target_cgroup_id SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} event_drops SEC(".maps");

struct klyn_trace_entry {
    __u16 common_type;
    __u8 common_flags;
    __u8 common_preempt_count;
    __s32 common_pid;
};

struct klyn_sched_fork_ctx {
    struct klyn_trace_entry common;
    char parent_comm[KLYN_TASK_COMM_LEN];
    __s32 parent_pid;
    __s32 parent_prio;
    char child_comm[KLYN_TASK_COMM_LEN];
    __s32 child_pid;
    __s32 child_prio;
};

struct klyn_sched_exit_ctx {
    struct klyn_trace_entry common;
    char comm[KLYN_TASK_COMM_LEN];
    __s32 pid;
    __s32 prio;
};

struct klyn_raw_sys_enter_ctx {
    struct klyn_trace_entry common;
    __s64 id;
    unsigned long args[6];
};

static __always_inline int klyn_in_target_cgroup(__u64 *current_cgroup)
{
    __u32 key = 0;
    __u64 *target = bpf_map_lookup_elem(&target_cgroup_id, &key);
    if (!target)
        return 0;
    *current_cgroup = bpf_get_current_cgroup_id();
    return *current_cgroup != 0 && *current_cgroup == *target;
}

static __always_inline int klyn_emit(__u32 kind, __s32 syscall_nr, __u64 value)
{
    __u64 cgroup_id = 0;
    if (!klyn_in_target_cgroup(&cgroup_id))
        return 0;

    __u64 pid_tgid = bpf_get_current_pid_tgid();
    struct klyn_event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        __u32 key = 0;
        __u64 *drops = bpf_map_lookup_elem(&event_drops, &key);
        if (drops)
            __sync_fetch_and_add(drops, 1);
        return 0;
    }

    event->timestamp_ns = bpf_ktime_get_ns();
    event->cgroup_id = cgroup_id;
    event->pid = (__u32)pid_tgid;
    event->tgid = (__u32)(pid_tgid >> 32);
    event->kind = kind;
    event->syscall_nr = syscall_nr;
    event->value = value;
    bpf_ringbuf_submit(event, 0);
    return 0;
}

SEC("tracepoint/sched/sched_process_fork")
int klyn_trace_sched_fork(struct klyn_sched_fork_ctx *ctx)
{
    return klyn_emit(KLYN_EVENT_FORK, -1, (__u64)(__u32)ctx->child_pid);
}

SEC("tracepoint/sched/sched_process_exit")
int klyn_trace_sched_exit(struct klyn_sched_exit_ctx *ctx)
{
    return klyn_emit(KLYN_EVENT_EXIT, -1, (__u64)(__u32)ctx->pid);
}

static __always_inline int klyn_is_sensitive_syscall(__s64 syscall_nr)
{
#ifdef __NR_openat
    if (syscall_nr == __NR_openat)
        return 1;
#endif
#ifdef __NR_openat2
    if (syscall_nr == __NR_openat2)
        return 1;
#endif
#ifdef __NR_execve
    if (syscall_nr == __NR_execve)
        return 1;
#endif
#ifdef __NR_execveat
    if (syscall_nr == __NR_execveat)
        return 1;
#endif
#ifdef __NR_clone
    if (syscall_nr == __NR_clone)
        return 1;
#endif
#ifdef __NR_clone3
    if (syscall_nr == __NR_clone3)
        return 1;
#endif
#ifdef __NR_fork
    if (syscall_nr == __NR_fork)
        return 1;
#endif
#ifdef __NR_vfork
    if (syscall_nr == __NR_vfork)
        return 1;
#endif
#ifdef __NR_socket
    if (syscall_nr == __NR_socket)
        return 1;
#endif
#ifdef __NR_connect
    if (syscall_nr == __NR_connect)
        return 1;
#endif
#ifdef __NR_ptrace
    if (syscall_nr == __NR_ptrace)
        return 1;
#endif
#ifdef __NR_bpf
    if (syscall_nr == __NR_bpf)
        return 1;
#endif
#ifdef __NR_io_uring_setup
    if (syscall_nr == __NR_io_uring_setup)
        return 1;
#endif
#ifdef __NR_unshare
    if (syscall_nr == __NR_unshare)
        return 1;
#endif
#ifdef __NR_setns
    if (syscall_nr == __NR_setns)
        return 1;
#endif
#ifdef __NR_mount
    if (syscall_nr == __NR_mount)
        return 1;
#endif
    return 0;
}

SEC("tracepoint/raw_syscalls/sys_enter")
int klyn_trace_raw_sys_enter(struct klyn_raw_sys_enter_ctx *ctx)
{
    if (klyn_is_sensitive_syscall(ctx->id))
        return klyn_emit(KLYN_EVENT_SENSITIVE_SYSCALL, (__s32)ctx->id, 0);
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
