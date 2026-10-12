//! Supervisor-side cgroup-v2 resource boundary.
//!
//! Resource controls are configured before the blocked worker is released.
//! PID attachment is verified by reading cgroup.procs back; a successful write
//! alone is not treated as proof of membership.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{CgroupV2, ResourceBudget, SandboxError};

pub const MIN_CPU_WEIGHT: u32 = 1;
pub const MAX_CPU_WEIGHT: u32 = 10_000;

pub struct CgroupV2Boundary {
    inner: CgroupV2,
    budget: ResourceBudget,
    cpu_weight: u32,
    path: PathBuf,
}

impl CgroupV2Boundary {
    /// Create and configure one per-worker cgroup under a pre-delegated v2
    /// hierarchy. The parent must already have enabled cpu, memory, and pids
    /// (plus io when requested) in cgroup.subtree_control.
    pub fn create(
        delegated_root: impl AsRef<Path>,
        worker_id: &str,
        budget: &ResourceBudget,
        cpu_weight: u32,
    ) -> Result<Self, SandboxError> {
        budget.validate()?;
        validate_cpu_weight(cpu_weight)?;

        // CgroupV2::create writes memory.max, memory.swap.max, memory.oom.group,
        // cpu.max, pids.max and requested io.max limits, then reads them back.
        let inner = CgroupV2::create(delegated_root, worker_id, budget)?;
        let path = inner.path().to_path_buf();
        if let Err(error) = write_control(&path.join("cpu.weight"), &cpu_weight.to_string()) {
            drop(inner);
            return Err(SandboxError::Io(error));
        }
        let boundary = Self {
            inner,
            budget: budget.clone(),
            cpu_weight,
            path,
        };
        boundary.verify_limits()?;
        Ok(boundary)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn budget(&self) -> &ResourceBudget {
        &self.budget
    }

    pub fn cpu_weight(&self) -> u32 {
        self.cpu_weight
    }

    /// Move the launcher into this cgroup and prove membership before an ACK
    /// can be sent. The launcher must be blocked on StartGate during this call.
    pub fn attach_and_verify(&self, pid: u32) -> Result<(), SandboxError> {
        if pid == 0 {
            return Err(SandboxError::InvalidConfig("PID zero is invalid".into()));
        }
        self.inner.attach_pid(pid)?;
        verify_pid_membership_file(&self.path.join("cgroup.procs"), pid)?;
        self.verify_limits()
    }

    /// Verify that the actual kernel controls still match the manifest. No
    /// values are inferred from requested settings; every control is read back.
    pub fn verify_limits(&self) -> Result<(), SandboxError> {
        if fs::read_to_string(self.path.join("cgroup.type"))?.trim() != "domain"
            || !self.path.join("cgroup.kill").exists()
        {
            return Err(SandboxError::Enforcement(
                "worker cgroup is not a killable domain cgroup".into(),
            ));
        }
        crate::verify_budget_controls(&self.path, &self.budget)?;
        let actual_weight = fs::read_to_string(self.path.join("cpu.weight"))?;
        if actual_weight.trim().parse::<u32>().ok() != Some(self.cpu_weight) {
            return Err(SandboxError::Enforcement(
                "effective cgroup cpu.weight differs from the signed manifest".into(),
            ));
        }
        Ok(())
    }

    /// Kill every process in this boundary and wait until the kernel reports
    /// that the cgroup is empty. Delegated to the authoritative cgroup handle.
    pub fn kill_all(&self) -> Result<(), SandboxError> {
        self.inner.kill_all()
    }

    pub fn terminate_and_wait(&self, timeout: Duration) -> Result<(), SandboxError> {
        self.inner.terminate_and_wait(timeout)
    }

    /// Fail-closed worker-side check: match /proc/self/cgroup to the exact
    /// manifest path, then independently verify all enforced resource controls.
    pub fn verify_current(
        expected_path: impl AsRef<Path>,
        budget: &ResourceBudget,
        cpu_weight: u32,
    ) -> Result<(), SandboxError> {
        budget.validate()?;
        if !(MIN_CPU_WEIGHT..=MAX_CPU_WEIGHT).contains(&cpu_weight) {
            return Err(SandboxError::InvalidConfig(
                "cgroup cpu.weight must be in 1..=10000".into(),
            ));
        }
        let proc_cgroup = fs::read_to_string("/proc/self/cgroup")?;
        let actual_path =
            crate::resolve_current_cgroup_path(&proc_cgroup, Path::new("/sys/fs/cgroup"))?;
        let expected_path = fs::canonicalize(expected_path)?;
        if actual_path != expected_path {
            return Err(SandboxError::Enforcement(format!(
                "worker cgroup mismatch: expected {}, found {}",
                expected_path.display(),
                actual_path.display()
            )));
        }

        crate::verify_current_cgroup_budget(budget)?;
        let actual_weight = fs::read_to_string(actual_path.join("cpu.weight"))?;
        if actual_weight.trim().parse::<u32>().ok() != Some(cpu_weight) {
            return Err(SandboxError::Enforcement(
                "effective cgroup cpu.weight differs from the signed manifest".into(),
            ));
        }
        Ok(())
    }
}

fn validate_cpu_weight(cpu_weight: u32) -> Result<(), SandboxError> {
    if !(MIN_CPU_WEIGHT..=MAX_CPU_WEIGHT).contains(&cpu_weight) {
        return Err(SandboxError::InvalidConfig(
            "cgroup cpu.weight must be in 1..=10000".into(),
        ));
    }
    Ok(())
}

fn write_control(path: &Path, value: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).open(path)?;
    file.write_all(value.as_bytes())?;
    file.flush()
}

fn verify_pid_membership_file(path: &Path, pid: u32) -> Result<(), SandboxError> {
    let contents = fs::read_to_string(path)?;
    let mut found = false;
    for line in contents.lines() {
        let member = line.trim().parse::<u32>().map_err(|_| {
            SandboxError::Enforcement("kernel returned malformed cgroup.procs content".into())
        })?;
        if member == pid {
            found = true;
        }
    }
    if !found {
        return Err(SandboxError::Enforcement(format!(
            "launcher PID {pid} is not present in the target cgroup.procs"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn cgroup_membership_readback_requires_the_exact_pid() {
        let root = tempfile::tempdir().expect("temporary cgroup fixture");
        let procs = root.path().join("cgroup.procs");
        fs::write(&procs, "321\n654\n").expect("write simulated membership");

        verify_pid_membership_file(&procs, 321).expect("expected PID is attached");
        verify_pid_membership_file(&procs, 654).expect("second PID is attached");
        assert!(verify_pid_membership_file(&procs, 65).is_err());
        assert!(verify_pid_membership_file(&procs, 999).is_err());

        fs::write(&procs, "not-a-pid\n").expect("write invalid membership");
        assert!(verify_pid_membership_file(&procs, 321).is_err());
    }

    #[test]
    fn cpu_weight_outside_kernel_range_is_rejected() {
        let budget = ResourceBudget {
            memory_max_bytes: 1024 * 1024,
            cpu_quota_micros: 1000,
            cpu_period_micros: 1000,
            pids_max: 2,
            io_limits: vec![],
        };
        assert!(budget.validate().is_ok());
        assert!(validate_cpu_weight(1).is_ok());
        assert!(validate_cpu_weight(10_000).is_ok());
        assert!(validate_cpu_weight(0).is_err());
        assert!(validate_cpu_weight(10_001).is_err());
    }

    #[test]
    fn empty_cgroup_path_never_resolves_as_a_valid_worker_boundary() {
        assert!(CgroupV2Boundary::verify_current(
            Path::new("/"),
            &ResourceBudget {
                memory_max_bytes: 1024 * 1024,
                cpu_quota_micros: 1000,
                cpu_period_micros: 1000,
                pids_max: 2,
                io_limits: vec![],
            },
            100,
        )
        .is_err());
    }
}
