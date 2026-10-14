//! Test-only worker image that passes the genuine KLYN bootstrap and then
//! remains CPU-bound until the supervisor's deadline kills its cgroup.
//!
//! This binary is installed only on an isolated privileged E2E VM under a
//! directory whose final executable name is `klyn-worker`. Never package it
//! into production images.
use std::process::ExitCode;

fn main() -> ExitCode {
    if klyn_sandbox::worker_bootstrap::initialize().is_err() {
        return ExitCode::from(125);
    }

    // Do not use a shell, filesystem side effects, or additional syscalls
    // after policy installation. A busy loop gives the real supervisor a
    // deterministic non-terminating task that the cgroup must kill.
    loop {
        std::hint::spin_loop();
    }
}
