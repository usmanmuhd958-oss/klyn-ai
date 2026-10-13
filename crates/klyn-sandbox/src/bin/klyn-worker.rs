//! Platform-gated trusted worker executable.

#[cfg(target_os = "linux")]
#[path = "platform/klyn_worker_linux.rs"]
mod linux;

#[cfg(target_os = "linux")]
fn main() {
    if let Err(error) = linux::run() {
        eprintln!("klyn-worker: {error}");
        std::process::exit(125);
    }
}

#[cfg(not(target_os = "linux"))]
fn main() -> ! {
    eprintln!("klyn-worker: unsupported platform; refusing worker execution");
    std::process::exit(125);
}
