//! Platform-gated stage-0 launcher.
//!
//! The Linux implementation is compiled only on Linux. Other targets retain
//! a binary target for workspace checks, but execution exits before any payload
//! is parsed, spawned, or executed.

#[cfg(target_os = "linux")]
#[path = "platform/klyn_sandbox_init_linux.rs"]
mod linux;

#[cfg(target_os = "linux")]
fn main() {
    linux::entry();
}

#[cfg(not(target_os = "linux"))]
fn main() -> ! {
    eprintln!(
        "klyn-sandbox-init: unsupported platform; refusing worker launch"
    );
    std::process::exit(125);
}
