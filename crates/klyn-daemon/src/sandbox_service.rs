//! Internal daemon-facing facade for the OS-enforced worker launcher.
//!
//! This is deliberately not an IPC method: model-facing requests cannot choose
//! arbitrary executables, cgroup paths, namespaces, or resource limits. The
//! trusted orchestration layer must provide a validated bootstrap and budget.

use std::{ffi::OsString, path::PathBuf, time::Duration};

use klyn_sandbox::{
    launch_gated_worker, ResourceBudget, SandboxError, SandboxedChild, WorkerLaunchSpec,
};

pub struct SandboxServiceConfig {
    pub trusted_bootstrap: PathBuf,
    pub gate_directory: PathBuf,
    pub delegated_cgroup_root: PathBuf,
    pub startup_timeout: Duration,
}

pub struct SandboxService {
    config: SandboxServiceConfig,
}

impl SandboxService {
    pub fn new(config: SandboxServiceConfig) -> Result<Self, SandboxError> {
        klyn_sandbox::validate_trusted_executable(&config.trusted_bootstrap)?;
        if config.startup_timeout.is_zero() || config.startup_timeout > Duration::from_secs(30) {
            return Err(SandboxError::InvalidConfig(
                "sandbox bootstrap timeout must be between 1ms and 30s".into(),
            ));
        }
        Ok(Self { config })
    }

    /// Launch a trusted bootstrap only. The bootstrap must call
    /// klyn_sandbox::namespace::await_start_gate and
    /// klyn_sandbox::bootstrap_worker_from_env before interpreting a task.
    pub fn launch_worker(
        &self,
        cgroup_id: &str,
        budget: ResourceBudget,
        trusted_args: Vec<OsString>,
    ) -> Result<SandboxedChild, SandboxError> {
        launch_gated_worker(WorkerLaunchSpec {
            executable: self.config.trusted_bootstrap.clone(),
            args: trusted_args,
            gate_directory: self.config.gate_directory.clone(),
            cgroup_root: self.config.delegated_cgroup_root.clone(),
            cgroup_id: cgroup_id.to_owned(),
            budget,
            startup_timeout: self.config.startup_timeout,
        })
    }
}
