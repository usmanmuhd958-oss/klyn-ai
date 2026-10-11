//! Legacy fixed-FD namespace helper, intentionally disabled.
//!
//! Its inherited-FD gate is incompatible with the current FIFO-gated worker
//! supervisor, and it does not install the current Landlock/seccomp policy
//! itself. It must not be used as a worker launcher. Until a concrete
//! application-specific worker bootstrap links
//! `klyn_sandbox::bootstrap_worker_from_env`, this binary exits fail-closed.

fn main() -> ! {
    eprintln!(
        "klyn-sandbox-init is disabled: configure a trusted worker bootstrap that          implements the FIFO gate, capability verification, Landlock, and seccomp"
    );
    std::process::exit(125);
}
