#![cfg(target_os = "linux")]

use std::{
    fs,
    io::Write,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ed25519_dalek::SigningKey;
use klyn_sandbox::{
    cgroup::CgroupV2Boundary,
    kel::KelJournal,
    telemetry::{KernelEventKind, TelemetryEvent, TelemetryMode, WorkerTelemetry},
    ResourceBudget,
};

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn native_ebpf_ring_buffer_delivers_cgroup_filtered_kernel_events() {
    if std::env::var("KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION").as_deref() != Ok("1") {
        eprintln!("SKIP: set KLYN_REQUIRE_NATIVE_LINUX_QUALIFICATION=1 on the dedicated native host");
        return;
    }

    let root = std::env::var_os("KLYN_TEST_CGROUP_ROOT")
        .expect("strict native qualification requires KLYN_TEST_CGROUP_ROOT");
    let bpf_object = std::env::var_os("KLYN_EBPF_OBJECT")
        .expect("strict native qualification requires KLYN_EBPF_OBJECT");
    assert!(std::path::Path::new(&bpf_object).is_file(), "KLYN_EBPF_OBJECT must be a compiled BPF ELF object");

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_nanos();
    let worker_id = format!("klyn-ebpf-{}-{nonce:x}", std::process::id());
    let budget = ResourceBudget {
        memory_max_bytes: 256 * 1024 * 1024,
        cpu_quota_micros: 100_000,
        cpu_period_micros: 100_000,
        pids_max: 64,
        io_limits: vec![],
    };
    let cgroup = CgroupV2Boundary::create(root, &worker_id, &budget, 100)
        .expect("create and read back live cgroup-v2 controls");

    // Keep the child blocked until after libbpf has loaded the programs and
    // attached the ring-buffer consumer to this cgroup.
    let child = Command::new("/bin/sh")
        .args([
            "-c",
            "read -r _; i=0; while [ "$i" -lt 40 ]; do /bin/true; i=$((i+1)); done; exec sleep 30",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn gated event-generating child");
    let mut child = ChildGuard(child);
    cgroup
        .attach_and_verify(child.0.id())
        .expect("verify child PID in cgroup.procs");

    let journal_dir = tempfile::tempdir().expect("temporary KEL journal directory");
    let journal_path = journal_dir.path().join("native-ebpf.kel");
    let signing_key = SigningKey::from_bytes(&[0x62; 32]);
    let journal = KelJournal::create(&journal_path, &signing_key, [0x63; 16])
        .expect("create strict test KEL journal")
        .shared();
    let mut telemetry = WorkerTelemetry::start_with_kel(
        cgroup.path(),
        child.0.id(),
        budget,
        journal,
    )
    .expect("attach eBPF and start cgroup telemetry");
    assert_eq!(
        telemetry.mode(),
        TelemetryMode::EbpfRingBuffer,
        "strict native test requires live eBPF ring-buffer mode, not cgroup-only fallback; object: {}",
        std::path::Path::new(&bpf_object).display()
    );

    child
        .0
        .stdin
        .take()
        .expect("child stdin gate")
        .write_all(b"go
")
        .expect("release event-generating child");

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut delivered_fork_event = false;
    while Instant::now() < deadline {
        if let Some(event) = telemetry.try_recv() {
            if let TelemetryEvent::Kernel(kernel) = event {
                if kernel.kind == KernelEventKind::ProcessFork
                    && kernel.cgroup_id == fs::metadata(cgroup.path()).expect("cgroup metadata").ino()
                {
                    delivered_fork_event = true;
                    break;
                }
            }
        } else {
            thread::sleep(Duration::from_millis(5));
        }
    }

    telemetry.stop_and_join().expect("stop telemetry monitor");
    cgroup
        .terminate_and_wait(Duration::from_secs(5))
        .expect("cgroup.kill empties the test cgroup");
    assert!(
        !cgroup.path().join("cgroup.events").exists()
            || fs::read_to_string(cgroup.path().join("cgroup.events"))
                .expect("read terminal cgroup events")
                .lines()
                .any(|line| line.trim() == "populated 0"),
        "test cgroup should be empty after authoritative teardown"
    );
    let _ = child.0.wait();

    assert!(
        delivered_fork_event,
        "eBPF ring buffer did not deliver a cgroup-filtered process-fork event within 10 seconds"
    );
}
