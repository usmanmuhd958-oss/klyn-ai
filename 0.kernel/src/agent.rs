use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TICK_INTERVAL_MS: u64 = 100;
const PROACTIVE_SCAN_INTERVAL_S: u64 = 300;
const MAX_TICK_LATENCY_MS: u64 = 10;
const MAX_ISSUES_BUFFER: usize = 512;

#[repr(C, align(64))]
pub struct DaemonMetrics {
    pub ticks: AtomicU64,
    pub active_issues: AtomicU64,
    pub last_scan_ts: AtomicU64,
    pub memory_usage: AtomicU64,
}

impl DaemonMetrics {
    pub const fn new() -> Self {
        Self {
            ticks: AtomicU64::new(0),
            active_issues: AtomicU64::new(0),
            last_scan_ts: AtomicU64::new(0),
            memory_usage: AtomicU64::new(0),
        }
    }

    pub fn update_memory(&self) {
        #[cfg(target_os = "linux")]
        {
            if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
                for line in status.lines() {
                    if line.starts_with("VmRSS:") {
                        if let Some(kb_str) = line.split_whitespace().nth(1) {
                            if let Ok(kb) = kb_str.parse::<u64>() {
                                self.memory_usage.store(kb * 1024, Ordering::Relaxed);
                                return;
                            }
                        }
                    }
                }
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            self.memory_usage.store(2_097_152, Ordering::Relaxed);
        }
    }
}

pub struct AgentDaemon {
    running: Arc<AtomicBool>,
    thread_handle: Option<JoinHandle<()>>,
    metrics: Arc<DaemonMetrics>,
}

static DAEMON: Mutex<Option<AgentDaemon>> = Mutex::new(None);

impl AgentDaemon {
    pub fn spawn() -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = Arc::clone(&running);
        let metrics = Arc::new(DaemonMetrics::new());
        let metrics_clone = Arc::clone(&metrics);

        let thread_handle = thread::spawn(move || {
            daemon_event_loop(running_clone, metrics_clone);
        });

        Self {
            running,
            thread_handle: Some(thread_handle),
            metrics,
        }
    }

    pub fn shutdown(&mut self) -> bool {
        self.running.store(false, Ordering::Release);

        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
            true
        } else {
            false
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    pub fn to_json_status(&self) -> String {
        format!(
            r#"{{"running":{},"ticks":{},"memory_mb":{:.3},"active_issues":{},"last_scan_ts":{}}}"#,
            self.is_running(),
            self.metrics.ticks.load(Ordering::Relaxed),
            self.metrics.memory_usage.load(Ordering::Relaxed) as f64 / 1_048_576.0,
            self.metrics.active_issues.load(Ordering::Relaxed),
            self.metrics.last_scan_ts.load(Ordering::Relaxed)
        )
    }
}

fn daemon_event_loop(running: Arc<AtomicBool>, metrics: Arc<DaemonMetrics>) {
    let mut last_proactive = Instant::now();
    let proactive_interval = Duration::from_secs(PROACTIVE_SCAN_INTERVAL_S);
    let tick_interval = Duration::from_millis(TICK_INTERVAL_MS);

    while running.load(Ordering::Acquire) {
        let tick_start = Instant::now();

        reactive_pipeline(&metrics);

        if last_proactive.elapsed() >= proactive_interval {
            proactive_pipeline(&metrics);
            last_proactive = Instant::now();
            
            let now_ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            metrics.last_scan_ts.store(now_ts, Ordering::Relaxed);
        }

        metrics.ticks.fetch_add(1, Ordering::Relaxed);
        metrics.update_memory();

        let elapsed = tick_start.elapsed();
        if elapsed.as_millis() > MAX_TICK_LATENCY_MS as u128 {
            bus::emit_event(vec![0xE0, 0x01]);
        }

        if let Some(sleep_duration) = tick_interval.checked_sub(elapsed) {
            thread::sleep(sleep_duration);
        }
    }
}

fn reactive_pipeline(metrics: &Arc<DaemonMetrics>) {
    let events = bus::drain_events();

    for event in events {
        if event.is_empty() {
            continue;
        }

        let event_type = event[0];
        match event_type {
            0x10 => handle_code_event(&event, metrics),
            0x11 => handle_bug_event(&event, metrics),
            0x12 => handle_security_event(&event, metrics),
            _ => {}
        }
    }
}

fn handle_code_event(event: &[u8], metrics: &Arc<DaemonMetrics>) {
    if event.len() < 4 {
        return;
    }

    let payload_len = u16::from_le_bytes([event[1], event[2]]) as usize;
    if payload_len > 0 && event.len() >= 4 + payload_len {
        let diff_slice = &event[4..4 + payload_len];

        if !law_vm::validate_raw_diff(diff_slice) {
            metrics.active_issues.fetch_add(1, Ordering::Relaxed);
            vault::store_violation(diff_slice);
        }
    }
}

fn handle_bug_event(event: &[u8], metrics: &Arc<DaemonMetrics>) {
    if event.len() >= 2 {
        let severity = event[1];
        if severity >= 3 {
            metrics.active_issues.fetch_add(1, Ordering::Relaxed);
            vault::store_bug_raw(&event[2..]);
        }
    }
}

fn handle_security_event(event: &[u8], metrics: &Arc<DaemonMetrics>) {
    if event.len() >= 2 {
        let threat_level = event[1];
        if threat_level > 5 {
            metrics.active_issues.fetch_add(1, Ordering::Relaxed);
            vault::store_violation(event);
        }
    }
}

fn proactive_pipeline(metrics: &Arc<DaemonMetrics>) {
    let issue_buffer = vault::recall_issues();

    for issue in issue_buffer.iter().take(MAX_ISSUES_BUFFER) {
        if issue.severity < 3 {
            continue;
        }

        if let Some(patch) = generate_fix_patch(issue) {
            if law_vm::validate_diff(&patch) {
                bus::emit_patch_proposal(&patch);
                metrics.active_issues.fetch_sub(1, Ordering::Relaxed);
            }
        }
    }
}

fn generate_fix_patch(issue: &vault::BugReport) -> Option<String> {
    if issue.file_path.is_empty() || issue.suggested_fix.is_empty() {
        return None;
    }

    let patch = format!(
        "--- {}\n+++ {}\n@@ -{},1 +{},1 @@\n-{}\n+{}",
        issue.file_path,
        issue.file_path,
        issue.line_number,
        issue.line_number,
        issue.problematic_line,
        issue.suggested_fix
    );

    if patch.len() > 8192 {
        return None;
    }

    Some(patch)
}

// NAPI EXPORTS
#[napi]
pub fn start_daemon() -> Result<bool> {
    let mut daemon_lock = DAEMON.lock().map_err(|e| Error::from_reason(e.to_string()))?;

    if let Some(ref daemon) = *daemon_lock {
        if daemon.is_running() {
            return Ok(false);
        }
    }

    let new_daemon = AgentDaemon::spawn();
    *daemon_lock = Some(new_daemon);

    Ok(true)
}

#[napi]
pub fn stop_daemon() -> Result<bool> {
    let mut daemon_lock = DAEMON.lock().map_err(|e| Error::from_reason(e.to_string()))?;

    if let Some(ref mut daemon) = *daemon_lock {
        let success = daemon.shutdown();
        if success {
            *daemon_lock = None;
            Ok(true)
        } else {
            Err(Error::from_reason("Daemon shutdown failed"))
        }
    } else {
        Ok(false)
    }
}

#[napi]
pub fn get_daemon_status() -> String {
    if let Ok(daemon_lock) = DAEMON.lock() {
        if let Some(ref daemon) = *daemon_lock {
            return daemon.to_json_status();
        }
    }
    r#"{"running":false,"ticks":0,"memory_mb":0.0,"active_issues":0,"last_scan_ts":0}"#.to_string()
}

#[napi]
pub fn force_proactive_scan() -> Result<u32> {
    let daemon_lock = DAEMON.lock().map_err(|e| Error::from_reason(e.to_string()))?;

    if let Some(ref daemon) = *daemon_lock {
        if !daemon.is_running() {
            return Err(Error::from_reason("Daemon not running"));
        }

        let issues_before = daemon.metrics.active_issues.load(Ordering::Relaxed);
        proactive_pipeline(&daemon.metrics);
        let issues_after = daemon.metrics.active_issues.load(Ordering::Relaxed);

        Ok(issues_before.saturating_sub(issues_after) as u32)
    } else {
        Err(Error::from_reason("Daemon not initialized"))
    }
}

#[napi]
pub fn get_tick_count() -> Result<u64> {
    let daemon_lock = DAEMON.lock().map_err(|e| Error::from_reason(e.to_string()))?;

    if let Some(ref daemon) = *daemon_lock {
        Ok(daemon.metrics.ticks.load(Ordering::Relaxed))
    } else {
        Ok(0)
    }
}

pub mod bus {
    use std::sync::Mutex;
    static EVENT_BUFFER: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

    pub fn emit_event(event: Vec<u8>) {
        if let Ok(mut buffer) = EVENT_BUFFER.lock() {
            buffer.push(event);
        }
    }

    pub fn drain_events() -> Vec<Vec<u8>> {
        if let Ok(mut buffer) = EVENT_BUFFER.lock() {
            std::mem::take(&mut *buffer)
        } else {
            Vec::new()
        }
    }

    pub fn emit_patch_proposal(patch: &str) {
        emit_event(patch.as_bytes().to_vec());
    }
}

pub mod vault {
    use std::sync::Mutex;

    #[derive(Clone, Default)]
    pub struct BugReport {
        pub file_path: String,
        pub line_number: usize,
        pub severity: u8,
        pub problematic_line: String,
        pub suggested_fix: String,
    }

    static ISSUES: Mutex<Vec<BugReport>> = Mutex::new(Vec::new());

    pub fn recall_issues() -> Vec<BugReport> {
        ISSUES.lock().map_or(Vec::new(), |i| i.clone())
    }

    pub fn store_violation(_diff: &[u8]) {
        if let Ok(mut issues) = ISSUES.lock() {
            if issues.len() < 512 {
                issues.push(BugReport {
                    severity: 5,
                    ..Default::default()
                });
            }
        }
    }

    pub fn store_bug_raw(_raw: &[u8]) {
        if let Ok(mut issues) = ISSUES.lock() {
            if issues.len() < 512 {
                issues.push(BugReport::default());
            }
        }
    }
}

pub mod law_vm {
    pub fn validate_diff(patch: &str) -> bool {
        if patch.is_empty() || patch.len() > 65536 {
            return false;
        }
        let forbidden = ["eval(", "exec(", "__import__", "rm -rf", "DROP TABLE"];
        !forbidden.iter().any(|&pattern| patch.contains(pattern))
    }

    pub fn validate_raw_diff(data: &[u8]) -> bool {
        !data.is_empty() && data.len() < 65536
    }
}
