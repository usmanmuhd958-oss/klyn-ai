//! Asynchronous cgroup-v2 telemetry with an optional libbpf ring-buffer source.
//!
//! eBPF is an observability accelerator, never an enforcement prerequisite:
//! strict seccomp and verified cgroup-v2 limits remain active when libbpf or a
//! trusted precompiled BPF object is unavailable. Anomaly decisions are made in
//! this monitor thread; the daemon-facing channel is best-effort and cannot
//! delay cgroup teardown.

use std::{
    collections::{BTreeMap, VecDeque},
    ffi::{CStr, CString},
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use crate::{ResourceBudget, SandboxError};

const DEFAULT_INTERVAL_MS: u64 = 250;
const MIN_INTERVAL_MS: u64 = 50;
const MAX_INTERVAL_MS: u64 = 5_000;
const DEFAULT_MAX_PAGE_FAULTS_PER_SECOND: u64 = 1_000_000;
const DEFAULT_MAX_IO_BYTES_PER_SECOND: u64 = 4 * 1024 * 1024 * 1024;
const DEFAULT_MAX_FORKS_PER_SECOND: u64 = 128;
const MEMORY_PRESSURE_PERCENT: u64 = 98;
const PUBLIC_EVENT_CAPACITY: usize = 1_024;
const KERNEL_EVENT_CAPACITY: usize = 4_096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum TelemetryMode {
    Starting = 0,
    EbpfRingBuffer = 1,
    CgroupV2Fallback = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KernelEventKind {
    ProcessFork,
    ProcessExit,
    SensitiveSyscall,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelEvent {
    pub kind: KernelEventKind,
    pub timestamp_ns: u64,
    pub cgroup_id: u64,
    pub pid: u32,
    pub tgid: u32,
    pub value: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnomalyKind {
    MemoryPressure,
    MemoryOom,
    PidLimitPressure,
    PageFaultBurst,
    IoBurst,
    ThreadSpawnBurst,
    SensitiveSyscall,
    WorkerExitedUnexpectedly,
    KernelTelemetryOverflow,
    MetricsUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CgroupSnapshot {
    pub memory_current_bytes: u64,
    pub memory_max_bytes: u64,
    pub cpu_usage_usec: u64,
    pub page_faults: u64,
    pub major_page_faults: u64,
    pub pids_current: u64,
    pub pids_max: u64,
    pub io_read_bytes: u64,
    pub io_write_bytes: u64,
    pub oom_events: u64,
    pub oom_kill_events: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TelemetryEvent {
    CapabilityWarning(String),
    Snapshot(CgroupSnapshot),
    Kernel(KernelEvent),
    Anomaly { kind: AnomalyKind, detail: String },
    EnforcementError(String),
}

pub struct WorkerTelemetry {
    stop: Arc<AtomicBool>,
    mode: Arc<AtomicU8>,
    receiver: Receiver<TelemetryEvent>,
    thread: Option<JoinHandle<()>>,
}

impl WorkerTelemetry {
    /// Start a mandatory cgroup-v2 monitor. KLYN_EBPF_OBJECT optionally names a
    /// root-owned, non-writable BPF ELF object compiled from
    /// ebpf/klyn_telemetry.bpf.c; a missing loader/object selects the explicit
    /// cgroup-v2 fallback and does not disable sandbox enforcement.
    pub fn start(
        cgroup_path: impl AsRef<Path>,
        worker_pid: u32,
        budget: ResourceBudget,
    ) -> Result<Self, SandboxError> {
        budget.validate()?;
        if worker_pid == 0 {
            return Err(SandboxError::InvalidConfig(
                "telemetry requires a non-zero worker PID".into(),
            ));
        }
        let cgroup_path = fs::canonicalize(cgroup_path)?;
        if !cgroup_path.join("cgroup.kill").is_file() {
            return Err(SandboxError::Enforcement(
                "telemetry target is not a killable cgroup-v2 boundary".into(),
            ));
        }
        let initial = read_snapshot(&cgroup_path)?;
        if initial.memory_max_bytes != budget.memory_max_bytes
            || initial.pids_max != u64::from(budget.pids_max)
        {
            return Err(SandboxError::Enforcement(
                "telemetry readback differs from the signed cgroup budget".into(),
            ));
        }

        let interval = configured_u64(
            "KLYN_TELEMETRY_INTERVAL_MS",
            DEFAULT_INTERVAL_MS,
            MIN_INTERVAL_MS,
            MAX_INTERVAL_MS,
        )?;
        let max_page_faults_per_second = configured_u64(
            "KLYN_MAX_PAGE_FAULTS_PER_SECOND",
            DEFAULT_MAX_PAGE_FAULTS_PER_SECOND,
            1,
            u64::MAX,
        )?;
        let max_io_bytes_per_second = configured_u64(
            "KLYN_MAX_IO_BYTES_PER_SECOND",
            DEFAULT_MAX_IO_BYTES_PER_SECOND,
            1,
            u64::MAX,
        )?;
        let max_forks_per_second = configured_u64(
            "KLYN_MAX_FORKS_PER_SECOND",
            DEFAULT_MAX_FORKS_PER_SECOND,
            1,
            1_000_000,
        )?;

        let (event_tx, receiver) = mpsc::sync_channel(PUBLIC_EVENT_CAPACITY);
        let (kernel_tx, kernel_rx) = mpsc::sync_channel(KERNEL_EVENT_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));
        let mode = Arc::new(AtomicU8::new(TelemetryMode::Starting as u8));
        let thread_stop = Arc::clone(&stop);
        let thread_mode = Arc::clone(&mode);
        let thread_path = cgroup_path.clone();
        let interval = Duration::from_millis(interval);
        let thread = thread::Builder::new()
            .name(format!("klyn-telemetry-{worker_pid}"))
            .spawn(move || {
                monitor_loop(MonitorConfig {
                    cgroup_path: thread_path,
                    worker_pid,
                    budget,
                    previous: initial,
                    interval,
                    max_page_faults_per_second,
                    max_io_bytes_per_second,
                    max_forks_per_second,
                    stop: thread_stop,
                    mode: thread_mode,
                    public_tx: event_tx,
                    kernel_tx,
                    kernel_rx,
                });
            })
            .map_err(|_| {
                SandboxError::Enforcement(
                    "failed to start mandatory cgroup telemetry monitor".into(),
                )
            })?;

        Ok(Self {
            stop,
            mode,
            receiver,
            thread: Some(thread),
        })
    }

    pub fn mode(&self) -> TelemetryMode {
        match self.mode.load(Ordering::Acquire) {
            1 => TelemetryMode::EbpfRingBuffer,
            2 => TelemetryMode::CgroupV2Fallback,
            _ => TelemetryMode::Starting,
        }
    }

    pub fn try_recv(&self) -> Option<TelemetryEvent> {
        self.receiver.try_recv().ok()
    }

    pub fn stop_and_join(&mut self) -> Result<(), SandboxError> {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.join().map_err(|_| {
                SandboxError::Enforcement("telemetry monitor thread panicked".into())
            })?;
        }
        Ok(())
    }
}

impl Drop for WorkerTelemetry {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct MonitorConfig {
    cgroup_path: PathBuf,
    worker_pid: u32,
    budget: ResourceBudget,
    previous: CgroupSnapshot,
    interval: Duration,
    max_page_faults_per_second: u64,
    max_io_bytes_per_second: u64,
    max_forks_per_second: u64,
    stop: Arc<AtomicBool>,
    mode: Arc<AtomicU8>,
    public_tx: SyncSender<TelemetryEvent>,
    kernel_tx: SyncSender<TelemetryEvent>,
    kernel_rx: Receiver<TelemetryEvent>,
}

fn monitor_loop(config: MonitorConfig) {
    let MonitorConfig {
        cgroup_path,
        worker_pid,
        budget,
        mut previous,
        interval,
        max_page_faults_per_second,
        max_io_bytes_per_second,
        max_forks_per_second,
        stop,
        mode,
        public_tx,
        kernel_tx,
        kernel_rx,
    } = config;
    let cgroup_id = match fs::metadata(&cgroup_path) {
        Ok(metadata) => metadata.ino(),
        Err(error) => {
            report_anomaly(
                &cgroup_path,
                &public_tx,
                AnomalyKind::MetricsUnavailable,
                format!("cannot identify telemetry cgroup: {error}"),
            );
            return;
        }
    };

    let mut ebpf = match std::env::var_os("KLYN_EBPF_OBJECT") {
        Some(path) => match EbpfSession::load(Path::new(&path), cgroup_id, kernel_tx.clone()) {
            Ok(session) => {
                mode.store(TelemetryMode::EbpfRingBuffer as u8, Ordering::Release);
                send_event(&public_tx, TelemetryEvent::CapabilityWarning(
                    "eBPF ring-buffer telemetry is active; cgroup-v2 controls remain authoritative"
                        .into(),
                ));
                Some(session)
            }
            Err(error) => {
                mode.store(TelemetryMode::CgroupV2Fallback as u8, Ordering::Release);
                send_event(&public_tx, TelemetryEvent::CapabilityWarning(format!(
                    "eBPF telemetry unavailable ({error}); using cgroup-v2 metrics and strict seccomp"
                )));
                None
            }
        },
        None => {
            mode.store(TelemetryMode::CgroupV2Fallback as u8, Ordering::Release);
            send_event(
                &public_tx,
                TelemetryEvent::CapabilityWarning(
                    "KLYN_EBPF_OBJECT is unset; using cgroup-v2 metrics and strict seccomp".into(),
                ),
            );
            None
        }
    };

    let mut last_sample_at = Instant::now();
    let mut recent_forks = VecDeque::new();
    let mut pending_kill: Option<(AnomalyKind, String)> = None;
    let mut seen_kernel_drops = 0_u64;
    let mut last_kernel_drop_check = Instant::now();

    send_event(&public_tx, TelemetryEvent::Snapshot(previous.clone()));

    while !stop.load(Ordering::Acquire) {
        let poll_error = ebpf.as_mut().and_then(|session| session.poll(20).err());
        if let Some(error) = poll_error {
            send_event(
                &public_tx,
                TelemetryEvent::CapabilityWarning(format!(
                    "eBPF ring-buffer polling failed ({error}); cgroup-v2 fallback remains active"
                )),
            );
            ebpf = None;
            mode.store(TelemetryMode::CgroupV2Fallback as u8, Ordering::Release);
        }

        while let Ok(event) = kernel_rx.try_recv() {
            let TelemetryEvent::Kernel(kernel_event) = event else {
                continue;
            };
            send_event(&public_tx, TelemetryEvent::Kernel(kernel_event.clone()));
            match kernel_event.kind {
                KernelEventKind::SensitiveSyscall => {
                    pending_kill = Some((
                        AnomalyKind::SensitiveSyscall,
                        format!(
                            "worker PID {} attempted sensitive syscall number {}",
                            kernel_event.pid, kernel_event.value
                        ),
                    ));
                }
                KernelEventKind::ProcessFork => {
                    let now = Instant::now();
                    recent_forks.push_back(now);
                    while recent_forks
                        .front()
                        .is_some_and(|time| now.duration_since(*time) > Duration::from_secs(1))
                    {
                        recent_forks.pop_front();
                    }
                    if recent_forks.len() as u64 > max_forks_per_second {
                        pending_kill = Some((
                            AnomalyKind::ThreadSpawnBurst,
                            format!(
                                "worker exceeded {max_forks_per_second} fork/thread events per second"
                            ),
                        ));
                    }
                }
                KernelEventKind::ProcessExit if kernel_event.pid == worker_pid => {
                    pending_kill = Some((
                        AnomalyKind::WorkerExitedUnexpectedly,
                        format!(
                            "supervised worker PID {worker_pid} exited before monitor shutdown"
                        ),
                    ));
                }
                KernelEventKind::ProcessExit => {}
            }
        }

        if let Some(session) = ebpf.as_ref() {
            let dropped = session.dropped_events();
            if dropped > seen_kernel_drops {
                seen_kernel_drops = dropped;
                pending_kill = Some((
                    AnomalyKind::KernelTelemetryOverflow,
                    format!("eBPF callback dropped {dropped} kernel event(s); event integrity is uncertain"),
                ));
            }
        }

        let elapsed = last_sample_at.elapsed();
        if elapsed >= interval {
            match read_snapshot(&cgroup_path) {
                Ok(current) => {
                    if current.memory_max_bytes != budget.memory_max_bytes
                        || current.pids_max != u64::from(budget.pids_max)
                    {
                        pending_kill = Some((
                            AnomalyKind::MetricsUnavailable,
                            "live cgroup memory.max/pids.max changed after launch".into(),
                        ));
                    } else if let Some((kind, detail)) = detect_anomaly(
                        &previous,
                        &current,
                        elapsed,
                        max_page_faults_per_second,
                        max_io_bytes_per_second,
                    ) {
                        pending_kill = Some((kind, detail));
                    }
                    send_event(&public_tx, TelemetryEvent::Snapshot(current.clone()));
                    previous = current;
                }
                Err(error) => {
                    pending_kill = Some((
                        AnomalyKind::MetricsUnavailable,
                        format!("required cgroup metrics became unavailable: {error}"),
                    ));
                }
            }

            if !Path::new(&format!("/proc/{worker_pid}")).exists() {
                pending_kill = Some((
                    AnomalyKind::WorkerExitedUnexpectedly,
                    format!(
                        "supervised worker PID {worker_pid} disappeared before monitor shutdown"
                    ),
                ));
            }
            last_sample_at = Instant::now();
        }

        if let Some((kind, detail)) = pending_kill.as_ref() {
            if write_cgroup_kill(&cgroup_path).is_ok() {
                send_event(
                    &public_tx,
                    TelemetryEvent::Anomaly {
                        kind: *kind,
                        detail: detail.clone(),
                    },
                );
                pending_kill = None;
            } else if last_kernel_drop_check.elapsed() >= Duration::from_millis(100) {
                send_event(
                    &public_tx,
                    TelemetryEvent::EnforcementError(format!(
                        "cgroup.kill write failed while handling {kind:?}; retrying"
                    )),
                );
                last_kernel_drop_check = Instant::now();
            }
        }

        if last_sample_at.elapsed() < interval && ebpf.is_none() {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

fn detect_anomaly(
    previous: &CgroupSnapshot,
    current: &CgroupSnapshot,
    elapsed: Duration,
    max_page_faults_per_second: u64,
    max_io_bytes_per_second: u64,
) -> Option<(AnomalyKind, String)> {
    if current.oom_events > previous.oom_events
        || current.oom_kill_events > previous.oom_kill_events
    {
        return Some((
            AnomalyKind::MemoryOom,
            "cgroup memory.events reported a new OOM or OOM kill".into(),
        ));
    }

    if current.memory_current_bytes.saturating_mul(100)
        >= current
            .memory_max_bytes
            .saturating_mul(MEMORY_PRESSURE_PERCENT)
    {
        return Some((
            AnomalyKind::MemoryPressure,
            format!(
                "memory.current={} is at least {}% of memory.max={}",
                current.memory_current_bytes, MEMORY_PRESSURE_PERCENT, current.memory_max_bytes
            ),
        ));
    }

    if current.pids_current >= current.pids_max {
        return Some((
            AnomalyKind::PidLimitPressure,
            format!(
                "pids.current={} reached pids.max={}",
                current.pids_current, current.pids_max
            ),
        ));
    }

    let seconds = elapsed.as_secs_f64().max(0.001);
    let page_fault_delta = current.page_faults.saturating_sub(previous.page_faults);
    if (page_fault_delta as f64 / seconds) > max_page_faults_per_second as f64 {
        return Some((
            AnomalyKind::PageFaultBurst,
            format!(
                "page-fault rate exceeded {max_page_faults_per_second}/s (delta={page_fault_delta})"
            ),
        ));
    }

    let io_delta = current
        .io_read_bytes
        .saturating_sub(previous.io_read_bytes)
        .saturating_add(
            current
                .io_write_bytes
                .saturating_sub(previous.io_write_bytes),
        );
    if (io_delta as f64 / seconds) > max_io_bytes_per_second as f64 {
        return Some((
            AnomalyKind::IoBurst,
            format!(
                "aggregate I/O rate exceeded {max_io_bytes_per_second} bytes/s (delta={io_delta})"
            ),
        ));
    }
    None
}

fn read_snapshot(cgroup_path: &Path) -> Result<CgroupSnapshot, SandboxError> {
    let memory_current_bytes = read_number(&cgroup_path.join("memory.current"))?;
    let memory_max_bytes = read_number(&cgroup_path.join("memory.max"))?;
    let pids_current = read_number(&cgroup_path.join("pids.current"))?;
    let pids_max = read_number(&cgroup_path.join("pids.max"))?;
    let cpu_stat = read_pairs(&cgroup_path.join("cpu.stat"))?;
    let memory_stat = read_pairs(&cgroup_path.join("memory.stat"))?;
    let memory_events = read_pairs(&cgroup_path.join("memory.events"))?;
    let (io_read_bytes, io_write_bytes) = read_io_stat(&cgroup_path.join("io.stat"))?;

    let required = |map: &BTreeMap<String, u64>, key: &str, file: &str| {
        map.get(key).copied().ok_or_else(|| {
            SandboxError::Enforcement(format!("cgroup metric {key} missing from {file}"))
        })
    };

    Ok(CgroupSnapshot {
        memory_current_bytes,
        memory_max_bytes,
        cpu_usage_usec: required(&cpu_stat, "usage_usec", "cpu.stat")?,
        page_faults: required(&memory_stat, "pgfault", "memory.stat")?,
        major_page_faults: required(&memory_stat, "pgmajfault", "memory.stat")?,
        pids_current,
        pids_max,
        io_read_bytes,
        io_write_bytes,
        oom_events: required(&memory_events, "oom", "memory.events")?,
        oom_kill_events: required(&memory_events, "oom_kill", "memory.events")?,
    })
}

fn read_number(path: &Path) -> Result<u64, SandboxError> {
    let value = fs::read_to_string(path)?;
    value.trim().parse::<u64>().map_err(|_| {
        SandboxError::Enforcement(format!(
            "cgroup control {} is not a finite unsigned integer",
            path.display()
        ))
    })
}

fn read_pairs(path: &Path) -> Result<BTreeMap<String, u64>, SandboxError> {
    let content = fs::read_to_string(path)?;
    let mut pairs = BTreeMap::new();
    for line in content.lines() {
        let mut parts = line.split_whitespace();
        let key = parts.next().ok_or_else(|| {
            SandboxError::Enforcement(format!("empty metric line in {}", path.display()))
        })?;
        let value = parts
            .next()
            .ok_or_else(|| {
                SandboxError::Enforcement(format!("missing value in {}", path.display()))
            })?
            .parse::<u64>()
            .map_err(|_| {
                SandboxError::Enforcement(format!("invalid value in {}", path.display()))
            })?;
        if parts.next().is_some() || pairs.insert(key.to_owned(), value).is_some() {
            return Err(SandboxError::Enforcement(format!(
                "malformed or duplicate metric in {}",
                path.display()
            )));
        }
    }
    Ok(pairs)
}

fn read_io_stat(path: &Path) -> Result<(u64, u64), SandboxError> {
    let content = fs::read_to_string(path)?;
    let mut read_bytes = 0_u64;
    let mut write_bytes = 0_u64;
    for line in content.lines() {
        let mut parts = line.split_whitespace();
        let _device = parts
            .next()
            .ok_or_else(|| SandboxError::Enforcement("missing device in cgroup io.stat".into()))?;
        for pair in parts {
            let (key, value) = pair.split_once('=').ok_or_else(|| {
                SandboxError::Enforcement("malformed key/value in cgroup io.stat".into())
            })?;
            let value = value.parse::<u64>().map_err(|_| {
                SandboxError::Enforcement("invalid numeric value in cgroup io.stat".into())
            })?;
            match key {
                "rbytes" => read_bytes = read_bytes.saturating_add(value),
                "wbytes" => write_bytes = write_bytes.saturating_add(value),
                _ => {}
            }
        }
    }
    Ok((read_bytes, write_bytes))
}

fn configured_u64(
    name: &str,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> Result<u64, SandboxError> {
    let Some(value) = std::env::var_os(name) else {
        return Ok(default);
    };
    let value = value.into_string().map_err(|_| {
        SandboxError::InvalidConfig(format!("{name} must be a UTF-8 unsigned integer"))
    })?;
    let value = value
        .parse::<u64>()
        .map_err(|_| SandboxError::InvalidConfig(format!("{name} must be an unsigned integer")))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(SandboxError::InvalidConfig(format!(
            "{name} must be in {minimum}..={maximum}"
        )));
    }
    Ok(value)
}

fn send_event(sender: &SyncSender<TelemetryEvent>, event: TelemetryEvent) {
    match sender.try_send(event) {
        Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
    }
}

fn report_anomaly(
    cgroup_path: &Path,
    sender: &SyncSender<TelemetryEvent>,
    kind: AnomalyKind,
    detail: String,
) {
    match write_cgroup_kill(cgroup_path) {
        Ok(()) => send_event(sender, TelemetryEvent::Anomaly { kind, detail }),
        Err(error) => send_event(
            sender,
            TelemetryEvent::EnforcementError(format!(
                "anomaly {kind:?} detected ({detail}); cgroup.kill failed: {error}"
            )),
        ),
    }
}

fn write_cgroup_kill(cgroup_path: &Path) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .open(cgroup_path.join("cgroup.kill"))?;
    file.write_all(b"1\n")?;
    file.flush()
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawBpfEvent {
    timestamp_ns: u64,
    cgroup_id: u64,
    pid: u32,
    tgid: u32,
    kind: u32,
    syscall_nr: i32,
    value: u64,
}

struct CallbackContext {
    sender: SyncSender<TelemetryEvent>,
    dropped: AtomicU64,
}

unsafe extern "C" fn sample_callback(
    context: *mut libc::c_void,
    data: *mut libc::c_void,
    size: usize,
) -> libc::c_int {
    if context.is_null() {
        return 0;
    }
    let context = unsafe { &*(context.cast::<CallbackContext>()) };
    if data.is_null() || size != std::mem::size_of::<RawBpfEvent>() {
        context.dropped.fetch_add(1, Ordering::Relaxed);
        return 0;
    }
    let raw = unsafe { ptr::read_unaligned(data.cast::<RawBpfEvent>()) };
    let kind = match raw.kind {
        1 => KernelEventKind::ProcessFork,
        2 => KernelEventKind::ProcessExit,
        3 => KernelEventKind::SensitiveSyscall,
        _ => return 0,
    };
    let value = if kind == KernelEventKind::SensitiveSyscall {
        raw.syscall_nr as u64
    } else {
        raw.value
    };
    let event = TelemetryEvent::Kernel(KernelEvent {
        kind,
        timestamp_ns: raw.timestamp_ns,
        cgroup_id: raw.cgroup_id,
        pid: raw.pid,
        tgid: raw.tgid,
        value,
    });
    if context.sender.try_send(event).is_err() {
        context.dropped.fetch_add(1, Ordering::Relaxed);
    }
    0
}

type ObjectOpenFn =
    unsafe extern "C" fn(*const libc::c_char, *const libc::c_void) -> *mut libc::c_void;
type GetErrorFn = unsafe extern "C" fn(*const libc::c_void) -> libc::c_long;
type ObjectLoadFn = unsafe extern "C" fn(*mut libc::c_void) -> libc::c_int;
type ObjectFindMapFn =
    unsafe extern "C" fn(*mut libc::c_void, *const libc::c_char) -> *mut libc::c_void;
type ObjectFindProgramFn =
    unsafe extern "C" fn(*mut libc::c_void, *const libc::c_char) -> *mut libc::c_void;
type MapUpdateFn = unsafe extern "C" fn(
    *mut libc::c_void,
    *const libc::c_void,
    usize,
    *const libc::c_void,
    usize,
    u64,
) -> libc::c_int;
type MapFdFn = unsafe extern "C" fn(*mut libc::c_void) -> libc::c_int;
type MapLookupFn = unsafe extern "C" fn(
    *mut libc::c_void,
    *const libc::c_void,
    usize,
    *mut libc::c_void,
    usize,
    u64,
) -> libc::c_int;
type AttachTracepointFn = unsafe extern "C" fn(
    *mut libc::c_void,
    *const libc::c_char,
    *const libc::c_char,
) -> *mut libc::c_void;
type SampleCallback =
    unsafe extern "C" fn(*mut libc::c_void, *mut libc::c_void, usize) -> libc::c_int;
type RingBufferNewFn = unsafe extern "C" fn(
    libc::c_int,
    SampleCallback,
    *mut libc::c_void,
    *const libc::c_void,
) -> *mut libc::c_void;
type RingBufferPollFn = unsafe extern "C" fn(*mut libc::c_void, libc::c_int) -> libc::c_int;
type RingBufferFreeFn = unsafe extern "C" fn(*mut libc::c_void);
type LinkDestroyFn = unsafe extern "C" fn(*mut libc::c_void) -> libc::c_int;
type ObjectCloseFn = unsafe extern "C" fn(*mut libc::c_void);

struct LibbpfApi {
    library: *mut libc::c_void,
    get_error: GetErrorFn,
    object_open_file: ObjectOpenFn,
    object_load: ObjectLoadFn,
    object_find_map: ObjectFindMapFn,
    object_find_program: ObjectFindProgramFn,
    map_update: MapUpdateFn,
    map_lookup: MapLookupFn,
    map_fd: MapFdFn,
    attach_tracepoint: AttachTracepointFn,
    ring_new: RingBufferNewFn,
    ring_poll: RingBufferPollFn,
    ring_free: RingBufferFreeFn,
    link_destroy: LinkDestroyFn,
    object_close: ObjectCloseFn,
}

impl LibbpfApi {
    fn load() -> Result<Self, String> {
        let mut library = ptr::null_mut();
        for candidate in ["libbpf.so.1", "libbpf.so"] {
            let name = CString::new(candidate).expect("static library name");
            library = unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
            if !library.is_null() {
                break;
            }
        }
        if library.is_null() {
            return Err(last_dl_error("libbpf is not installed"));
        }

        macro_rules! symbol {
            ($name:literal, $type:ty) => {{
                match unsafe { load_symbol::<$type>(library, $name) } {
                    Ok(symbol) => symbol,
                    Err(error) => {
                        unsafe { libc::dlclose(library) };
                        return Err(error);
                    }
                }
            }};
        }

        Ok(Self {
            library,
            get_error: symbol!("libbpf_get_error", GetErrorFn),
            object_open_file: symbol!("bpf_object__open_file", ObjectOpenFn),
            object_load: symbol!("bpf_object__load", ObjectLoadFn),
            object_find_map: symbol!("bpf_object__find_map_by_name", ObjectFindMapFn),
            object_find_program: symbol!("bpf_object__find_program_by_name", ObjectFindProgramFn),
            map_update: symbol!("bpf_map__update_elem", MapUpdateFn),
            map_lookup: symbol!("bpf_map__lookup_elem", MapLookupFn),
            map_fd: symbol!("bpf_map__fd", MapFdFn),
            attach_tracepoint: symbol!("bpf_program__attach_tracepoint", AttachTracepointFn),
            ring_new: symbol!("ring_buffer__new", RingBufferNewFn),
            ring_poll: symbol!("ring_buffer__poll", RingBufferPollFn),
            ring_free: symbol!("ring_buffer__free", RingBufferFreeFn),
            link_destroy: symbol!("bpf_link__destroy", LinkDestroyFn),
            object_close: symbol!("bpf_object__close", ObjectCloseFn),
        })
    }
}

impl Drop for LibbpfApi {
    fn drop(&mut self) {
        if !self.library.is_null() {
            unsafe { libc::dlclose(self.library) };
            self.library = ptr::null_mut();
        }
    }
}

/// Resolve a libbpf symbol with the ABI type expected by this loader.
///
/// # Safety
/// `name` must identify a function whose C ABI and signature exactly match `T`.
unsafe fn load_symbol<T: Copy>(library: *mut libc::c_void, name: &str) -> Result<T, String> {
    let name = CString::new(name).map_err(|_| "invalid libbpf symbol name".to_owned())?;
    let raw = unsafe { libc::dlsym(library, name.as_ptr()) };
    if raw.is_null() {
        return Err(last_dl_error("required libbpf symbol is missing"));
    }
    // POSIX dlsym returns function pointers through void * on supported Linux ABIs.
    Ok(unsafe { std::mem::transmute_copy::<*mut libc::c_void, T>(&raw) })
}

fn last_dl_error(fallback: &str) -> String {
    let error = unsafe { libc::dlerror() };
    if error.is_null() {
        fallback.to_owned()
    } else {
        unsafe { CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned()
    }
}

struct EbpfSession {
    api: LibbpfApi,
    object: *mut libc::c_void,
    links: Vec<*mut libc::c_void>,
    drop_map: *mut libc::c_void,
    ring: *mut libc::c_void,
    callback: Box<CallbackContext>,
}

impl EbpfSession {
    fn load(
        object_path: &Path,
        cgroup_id: u64,
        sender: SyncSender<TelemetryEvent>,
    ) -> Result<Self, String> {
        validate_bpf_object(object_path)?;
        let object_path = fs::canonicalize(object_path).map_err(|error| error.to_string())?;
        let path_bytes = object_path.to_string_lossy();
        let object_name = CString::new(path_bytes.as_bytes())
            .map_err(|_| "BPF object path contains a nul byte".to_owned())?;
        let api = LibbpfApi::load()?;
        let object = unsafe { (api.object_open_file)(object_name.as_ptr(), ptr::null()) };
        if object.is_null() || unsafe { (api.get_error)(object.cast_const()) } != 0 {
            return Err("libbpf could not open the configured BPF object".into());
        }

        let mut session = Self {
            api,
            object,
            links: Vec::with_capacity(3),
            drop_map: ptr::null_mut(),
            ring: ptr::null_mut(),
            callback: Box::new(CallbackContext {
                sender,
                dropped: AtomicU64::new(0),
            }),
        };
        session.initialize(cgroup_id)?;
        Ok(session)
    }

    fn initialize(&mut self, cgroup_id: u64) -> Result<(), String> {
        let load_result = unsafe { (self.api.object_load)(self.object) };
        if load_result != 0 {
            return Err(format!("libbpf BPF object load failed: {load_result}"));
        }

        let target_map_name = CString::new("target_cgroup_id").expect("static map name");
        let target_map =
            unsafe { (self.api.object_find_map)(self.object, target_map_name.as_ptr()) };
        if target_map.is_null() {
            return Err("BPF object is missing target_cgroup_id map".into());
        }
        let key = 0_u32;
        let update_result = unsafe {
            (self.api.map_update)(
                target_map,
                (&key as *const u32).cast(),
                std::mem::size_of_val(&key),
                (&cgroup_id as *const u64).cast(),
                std::mem::size_of_val(&cgroup_id),
                0,
            )
        };
        if update_result != 0 {
            return Err(format!(
                "failed to scope BPF events to cgroup ID {cgroup_id}"
            ));
        }

        let drop_map_name = CString::new("event_drops").expect("static drop map name");
        self.drop_map = unsafe { (self.api.object_find_map)(self.object, drop_map_name.as_ptr()) };
        if self.drop_map.is_null() {
            return Err("BPF object is missing event_drops counter map".into());
        }

        self.attach_tracepoint("klyn_trace_sched_fork", "sched", "sched_process_fork")?;
        self.attach_tracepoint("klyn_trace_sched_exit", "sched", "sched_process_exit")?;
        self.attach_tracepoint("klyn_trace_raw_sys_enter", "raw_syscalls", "sys_enter")?;

        let events_map_name = CString::new("events").expect("static map name");
        let events_map =
            unsafe { (self.api.object_find_map)(self.object, events_map_name.as_ptr()) };
        if events_map.is_null() {
            return Err("BPF object is missing events ring-buffer map".into());
        }
        let map_fd = unsafe { (self.api.map_fd)(events_map) };
        if map_fd < 0 {
            return Err("libbpf returned an invalid events map fd".into());
        }
        let callback_context = (&mut *self.callback as *mut CallbackContext).cast();
        self.ring =
            unsafe { (self.api.ring_new)(map_fd, sample_callback, callback_context, ptr::null()) };
        if self.ring.is_null() || unsafe { (self.api.get_error)(self.ring.cast_const()) } != 0 {
            self.ring = ptr::null_mut();
            return Err("libbpf could not initialize the BPF ring-buffer reader".into());
        }
        Ok(())
    }

    fn attach_tracepoint(
        &mut self,
        program_name: &str,
        category: &str,
        name: &str,
    ) -> Result<(), String> {
        let program_name = CString::new(program_name).expect("static BPF program name");
        let category = CString::new(category).expect("static tracepoint category");
        let name = CString::new(name).expect("static tracepoint name");
        let program = unsafe { (self.api.object_find_program)(self.object, program_name.as_ptr()) };
        if program.is_null() {
            return Err(format!(
                "BPF object is missing program {}",
                program_name.to_string_lossy()
            ));
        }
        let link =
            unsafe { (self.api.attach_tracepoint)(program, category.as_ptr(), name.as_ptr()) };
        if link.is_null() || unsafe { (self.api.get_error)(link.cast_const()) } != 0 {
            return Err(format!(
                "libbpf could not attach tracepoint {}/{}",
                category.to_string_lossy(),
                name.to_string_lossy()
            ));
        }
        self.links.push(link);
        Ok(())
    }

    fn poll(&mut self, timeout_ms: i32) -> Result<(), String> {
        let result = unsafe { (self.api.ring_poll)(self.ring, timeout_ms) };
        if result < 0 && result != -libc::EINTR {
            return Err(format!("libbpf ring-buffer poll failed: {result}"));
        }
        Ok(())
    }

    fn dropped_events(&self) -> u64 {
        let key = 0_u32;
        let mut kernel_drops = 0_u64;
        let result = unsafe {
            (self.api.map_lookup)(
                self.drop_map,
                (&key as *const u32).cast(),
                std::mem::size_of_val(&key),
                (&mut kernel_drops as *mut u64).cast(),
                std::mem::size_of_val(&kernel_drops),
                0,
            )
        };
        if result != 0 {
            // A lost-event counter that cannot be read makes the telemetry
            // stream untrustworthy; report overflow so the monitor kills the cgroup.
            return u64::MAX;
        }
        self.callback
            .dropped
            .load(Ordering::Acquire)
            .saturating_add(kernel_drops)
    }
}

impl Drop for EbpfSession {
    fn drop(&mut self) {
        if !self.ring.is_null() {
            unsafe { (self.api.ring_free)(self.ring) };
            self.ring = ptr::null_mut();
        }
        for link in self.links.drain(..).rev() {
            if !link.is_null() {
                unsafe { (self.api.link_destroy)(link) };
            }
        }
        if !self.object.is_null() {
            unsafe { (self.api.object_close)(self.object) };
            self.object = ptr::null_mut();
        }
    }
}

fn validate_bpf_object(path: &Path) -> Result<(), String> {
    let supplied = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if supplied.file_type().is_symlink() || !supplied.is_file() {
        return Err("BPF object must be a regular file, not a symlink".into());
    }
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if metadata.uid() != 0 || metadata.mode() & 0o222 != 0 {
        return Err("BPF object must be root-owned and non-writable".into());
    }
    let mut parent = canonical.parent();
    while let Some(directory) = parent {
        let metadata = fs::metadata(directory).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(format!(
                "BPF object has an unsafe parent directory: {}",
                directory.display()
            ));
        }
        if directory == Path::new("/") {
            break;
        }
        parent = directory.parent();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cgroup_pairs_reject_duplicate_and_malformed_metrics() {
        let root = tempfile::tempdir().expect("temporary metric fixture");
        let metric = root.path().join("memory.events");
        fs::write(&metric, "oom 0\noom_kill 1\n").expect("write metric fixture");
        let pairs = read_pairs(&metric).expect("valid key/value metrics");
        assert_eq!(pairs.get("oom"), Some(&0));
        assert_eq!(pairs.get("oom_kill"), Some(&1));

        fs::write(&metric, "oom 0\noom 1\n").expect("write duplicate fixture");
        assert!(read_pairs(&metric).is_err());
        fs::write(&metric, "oom invalid\n").expect("write invalid fixture");
        assert!(read_pairs(&metric).is_err());
    }

    #[test]
    fn io_stat_aggregates_devices_without_overflow() {
        let root = tempfile::tempdir().expect("temporary io fixture");
        let metric = root.path().join("io.stat");
        fs::write(
            &metric,
            "8:0 rbytes=100 wbytes=50 rios=1 wios=2\n259:1 rbytes=7 wbytes=9 rios=3 wios=4\n",
        )
        .expect("write io fixture");
        assert_eq!(read_io_stat(&metric).expect("parse io.stat"), (107, 59));
    }

    #[test]
    fn anomaly_thresholds_detect_memory_oom_and_pid_exhaustion() {
        let previous = CgroupSnapshot {
            memory_current_bytes: 10,
            memory_max_bytes: 100,
            cpu_usage_usec: 10,
            page_faults: 100,
            major_page_faults: 1,
            pids_current: 1,
            pids_max: 4,
            io_read_bytes: 0,
            io_write_bytes: 0,
            oom_events: 0,
            oom_kill_events: 0,
        };
        let mut current = previous.clone();
        current.oom_kill_events = 1;
        assert_eq!(
            detect_anomaly(
                &previous,
                &current,
                Duration::from_millis(250),
                10_000,
                1_000_000
            )
            .map(|value| value.0),
            Some(AnomalyKind::MemoryOom)
        );

        current = previous.clone();
        current.pids_current = 4;
        assert_eq!(
            detect_anomaly(&previous, &current, Duration::from_millis(250), 10_000, 1_000_000)
                .map(|value| value.0),
            Some(AnomalyKind::PidLimitPressure)
        );
    }
}
