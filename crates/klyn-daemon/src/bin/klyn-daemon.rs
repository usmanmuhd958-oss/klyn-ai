//! Platform-gated daemon entry point.

#[cfg(target_os = "linux")]
#[path = "platform/klyn_daemon_linux.rs"]
mod linux;

#[cfg(target_os = "linux")]
fn main() {
    linux::entry();
}

#[cfg(not(target_os = "linux"))]
fn main() -> ! {
    eprintln!("klyn-daemon: native Linux sandbox unsupported; refusing worker service");
    std::process::exit(125);
}
