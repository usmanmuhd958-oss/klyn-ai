//! =============================================================================
//! KLYN AI OS — 0.kernel (Rust Heart) — Deep System Telemetry (Phase 10)
//! File: 0.kernel/src/telemetry.rs
//!
//! Native process sampling and exit-wait primitives for the SystemMonitor
//! (2.body/sysmon.ts) and TelemetryBridge (1.bridge/src/telemetry_bridge.ts):
//!
//!   - `sample_process(pid)`  — cheap /proc snapshot (rss, cpu ticks, thread
//!     count, io counters). No process spawn, no wait, sub-100µs steady.
//!   - `pidfd_wait(pid, ms)`  — Linux pidfd + waitid: parks on the OS-level
//!     exit notification and returns the exact exit code / terminating signal
//!     in a single syscall pair. This is how runtime panics, segfaults and
//!     OOM-kills are caught at the kernel boundary instead of user-land
//!     wrappers (Node can only report `signal` for processes it spawned;
//!     pidfd covers arbitrary pids, and sampled children alike).
//!
//! Both are plain std + libc (no new runtime deps); build with
//! `cargo build --release` in 0.kernel/ to produce the napi addon that
//! 1.bridge/src/telemetry_bridge.ts probes for.
//! =============================================================================

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs;
use std::path::PathBuf;

/// CLK_TCK on Linux — 100 ticks/s on the overwhelming majority of kernels.
const TICKS_PER_SEC: f64 = 100.0;
/// Default page size on x86_64/aarch64 Linux.
const PAGE_BYTES: i64 = 4096;

/// One /proc snapshot of a live (or recently dead) process.
#[napi(object)]
pub struct ProcessSample {
    pub pid: i32,
    pub alive: bool,
    pub rss_kb: i64,
    pub utime_ms: i64,
    pub stime_ms: i64,
    pub threads: i64,
    pub read_bytes: i64,
    pub write_bytes: i64,
}

/// Result of waiting for a process to exit (native pidfd path).
#[napi(object)]
pub struct ProcessExit {
    pub pid: i32,
    pub exited: bool,
    /// Exit code, or -1 when the process was terminated by a signal.
    pub exit_code: i32,
    /// Signal name (e.g. "SIGSEGV", "SIGKILL") or empty when it exited normally.
    pub signal: String,
    /// Time spent waiting, in milliseconds.
    pub waited_ms: i64,
}

fn proc_dir(pid: i32) -> PathBuf {
    PathBuf::from(format!("/proc/{pid}"))
}

/// Parse utime/stime ticks, thread count and rss pages from /proc/<pid>/stat.
/// `comm` may contain spaces and parentheses, so everything before the last
/// `)` is skipped; field N (1-indexed) is then `fields[N - 3]`.
fn parse_stat(pid: i32) -> Option<(i64, i64, i64, i64)> {
    let stat = fs::read_to_string(proc_dir(pid).join("stat")).ok()?;
    let after_comm = stat.rsplit_once(')')?.1;
    let fields: Vec<&str> = after_comm.split_whitespace().collect();
    let get = |n: usize| fields.get(n - 3).and_then(|s| s.parse::<i64>().ok());
    Some((get(14)?, get(15)?, get(20)?, get(24)?))
}

/// Best-effort VmRSS (kB) from /proc/<pid>/status; falls back to pages*4.
fn read_status_rss(pid: i32, rss_pages: i64) -> i64 {
    let status = match fs::read_to_string(proc_dir(pid).join("status")) {
        Ok(s) => s,
        Err(_) => return rss_pages * (PAGE_BYTES / 1024),
    };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            if let Some(kb) = rest.trim().trim_end_matches("kB").trim().parse::<i64>().ok() {
                return kb;
            }
        }
    }
    rss_pages * (PAGE_BYTES / 1024)
}

/// Best-effort read/write byte counters from /proc/<pid>/io (own processes
/// only — permission denied elsewhere, silently defaulting to 0).
fn read_io(pid: i32) -> (i64, i64) {
    let mut read_bytes = 0i64;
    let mut write_bytes = 0i64;
    let io = match fs::read_to_string(proc_dir(pid).join("io")) {
        Ok(s) => s,
        Err(_) => return (0, 0),
    };
    for line in io.lines() {
        if let Some(rest) = line.strip_prefix("read_bytes:") {
            if let Ok(v) = rest.trim().parse::<i64>() {
                read_bytes = v;
            }
        } else if let Some(rest) = line.strip_prefix("write_bytes:") {
            if let Ok(v) = rest.trim().parse::<i64>() {
                write_bytes = v;
            }
        }
    }
    (read_bytes, write_bytes)
}

/// Snapshot one process. `alive: false` means the pid is gone (or invalid).
#[napi]
pub fn sample_process(pid: i32) -> Result<ProcessSample> {
    if pid <= 0 {
        return Err(Error::from_reason("sample_process: invalid pid"));
    }
    let dead = ProcessSample {
        pid,
        alive: false,
        rss_kb: 0,
        utime_ms: 0,
        stime_ms: 0,
        threads: 0,
        read_bytes: 0,
        write_bytes: 0,
    };
    if !proc_dir(pid).join("stat").exists() {
        return Ok(dead);
    }
    let (ut, st, threads, rss_pages) = match parse_stat(pid) {
        Some(v) => v,
        None => return Ok(dead),
    };
    let (read_bytes, write_bytes) = read_io(pid);
    Ok(ProcessSample {
        pid,
        alive: true,
        rss_kb: read_status_rss(pid, rss_pages),
        utime_ms: (ut as f64 * 1000.0 / TICKS_PER_SEC) as i64,
        stime_ms: (st as f64 * 1000.0 / TICKS_PER_SEC) as i64,
        threads,
        read_bytes,
        write_bytes,
    })
}

/// Wait up to `timeout_ms` for a process to exit using pidfd + waitid.
/// Returns the exact exit code / signal when it exits, `exited: false` on
/// timeout, and `exited: false` with 0ms wait when the pid is unknown.
#[cfg(target_os = "linux")]
#[napi]
pub fn pidfd_wait(pid: i32, timeout_ms: i32) -> Result<ProcessExit> {
    if pid <= 0 {
        return Err(Error::from_reason("pidfd_wait: invalid pid"));
    }
    let started = std::time::Instant::now();

    // SAFETY: pidfd_open returns a fresh fd or -1; no memory is touched.
    let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) } as libc::c_int;
    if fd < 0 {
        // ESRCH -> the process does not exist at all.
        return Ok(ProcessExit {
            pid,
            exited: false,
            exit_code: -1,
            signal: String::new(),
            waited_ms: 0,
        });
    }

    let mut pfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: poll only reads/writes the pollfd we own.
    let rc = unsafe { libc::poll(&mut pfd, 1, timeout_ms) };
    if rc == 0 {
        // SAFETY: close on a valid fd.
        unsafe { libc::close(fd) };
        return Ok(ProcessExit {
            pid,
            exited: false,
            exit_code: -1,
            signal: String::new(),
            waited_ms: timeout_ms as i64,
        });
    }
    if rc < 0 {
        // SAFETY: close on a valid fd.
        unsafe { libc::close(fd) };
        return Err(Error::from_reason(format!(
            "pidfd_wait: poll: {}",
            std::io::Error::last_os_error()
        )));
    }

    // SAFETY: siginfo_t is fully zero-initialized before waitid writes it.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    // SAFETY: P_PIDFD + the open pidfd; waitid writes into `info`.
    let wr = unsafe { libc::waitid(libc::P_PIDFD, fd as libc::id_t, &mut info, libc::WEXITED) };
    // SAFETY: close on a valid fd.
    unsafe { libc::close(fd) };

    if wr < 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ECHILD) {
            // Already reaped by another waiter (rare) — treat as exited.
            return Ok(ProcessExit {
                pid,
                exited: false,
                exit_code: -1,
                signal: String::new(),
                waited_ms: started.elapsed().as_millis() as i64,
            });
        }
        return Err(Error::from_reason(format!("pidfd_wait: waitid: {err}")));
    }

    let waited_ms = started.elapsed().as_millis() as i64;
    let status = info.si_status();
    let code = info.si_code();
    if code == libc::CLD_EXITED {
        Ok(ProcessExit {
            pid,
            exited: true,
            exit_code: status,
            signal: String::new(),
            waited_ms,
        })
    } else {
        // CLD_KILLED / CLD_DUMPED — terminated by a signal.
        let name = unsafe { libc::strsignal(status) };
        let signal = if name.is_null() {
            String::new()
        } else {
            // SAFETY: strsignal returns a valid NUL-terminated static string.
            unsafe { std::ffi::CStr::from_ptr(name) }
                .to_string_lossy()
                .into_owned()
        };
        Ok(ProcessExit {
            pid,
            exited: true,
            exit_code: -1,
            signal,
            waited_ms,
        })
    }
}

/// Non-Linux fallback — the bridge degrades to /proc polling.
#[cfg(not(target_os = "linux"))]
#[napi]
pub fn pidfd_wait(pid: i32, timeout_ms: i32) -> Result<ProcessExit> {
    let _ = (pid, timeout_ms);
    Err(Error::from_reason(
        "pidfd_wait is Linux-only; the JS bridge falls back to /proc polling",
    ))
}
