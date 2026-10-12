//! Platform-gated stage-0 launcher.
//!
//! Linux enforcement is implemented only in the Linux-specific module. On
//! unsupported targets this binary exits before parsing or executing payloads.

#[cfg(target_os = "linux")]
#[path = "platform/klyn_sandbox_init_linux.rs"]
mod linux;

#[cfg(target_os = "linux")]
fn main() {
    linux::entry();
}

#[cfg(not(target_os = "linux"))]
fn main() -> ! {
    eprintln!("klyn-sandbox-init: unsupported platform; refusing worker launch");
    std::process::exit(125);
}
