//! Supervisor-to-worker two-phase startup gate.
//!
//! FD 5 releases only the trusted stage-0 launcher after cgroup assignment and
//! resource-control readback. FD 6 is a second, private socketpair: the worker
//! reports readiness only after Landlock and seccomp have both been confirmed,
//! then remains blocked until the supervisor issues the mission-release ACK.

use std::{
    io::{Read, Write},
    os::{fd::FromRawFd, unix::net::UnixStream},
    time::Duration,
};

use ed25519_dalek::VerifyingKey;

use crate::{cgroup::CgroupV2Boundary, manifest::WorkerManifest, SandboxError};

pub const START_GATE_FD: i32 = 5;
pub const START_GATE_RELEASE: u8 = 0xA5;
pub const WORKER_POLICY_GATE_FD: i32 = 6;
pub const WORKER_POLICY_READY: u8 = 0xC3;
pub const MISSION_RELEASE: u8 = 0x5A;

pub struct StartGate {
    supervisor: UnixStream,
    released: bool,
}

impl StartGate {
    /// Return the supervisor endpoint and the child endpoint. Pass the child
    /// endpoint to Command::pre_exec and dup it to FD 5.
    pub fn pair() -> Result<(Self, UnixStream), SandboxError> {
        let (supervisor, child) = UnixStream::pair().map_err(SandboxError::Io)?;
        Ok((
            Self {
                supervisor,
                released: false,
            },
            child,
        ))
    }

    /// Attach a blocked stage-0 process, verify its actual cgroup controls,
    /// bind those controls to the signed manifest, then send the initial ACK.
    /// This ACK permits trusted bootstrap only, never mission execution.
    pub fn release_after_verification(
        &mut self,
        cgroup: &CgroupV2Boundary,
        pid: u32,
        manifest: &WorkerManifest,
        verifying_key: &VerifyingKey,
    ) -> Result<(), SandboxError> {
        manifest.verify_signature(verifying_key)?;
        if manifest.cgroup_path.as_path() != cgroup.path() {
            return Err(SandboxError::Enforcement(
                "sealed manifest cgroup path does not match the supervisor cgroup".into(),
            ));
        }
        if &manifest.capability.claims.budget != cgroup.budget()
            || manifest.cpu_weight != cgroup.cpu_weight()
        {
            return Err(SandboxError::Enforcement(
                "sealed manifest resource budget does not match the configured cgroup".into(),
            ));
        }
        self.release_after_check(|| cgroup.attach_and_verify(pid))
    }

    fn release_after_check(
        &mut self,
        verify: impl FnOnce() -> Result<(), SandboxError>,
    ) -> Result<(), SandboxError> {
        if self.released {
            return Err(SandboxError::Enforcement(
                "start gate has already been released".into(),
            ));
        }
        verify()?;
        self.supervisor.write_all(&[START_GATE_RELEASE])?;
        self.supervisor.flush()?;
        self.released = true;
        Ok(())
    }
}

/// Parent-side final gate. The worker must report POLICY_READY after its
/// bootstrap has confirmed Landlock ABI/ruleset enforcement and installed the
/// default-deny seccomp filter. Only this verified state receives MISSION_RELEASE.
pub struct WorkerPolicyGate {
    supervisor: UnixStream,
    released: bool,
}

impl WorkerPolicyGate {
    pub fn pair() -> Result<(Self, UnixStream), SandboxError> {
        let (supervisor, child) = UnixStream::pair().map_err(SandboxError::Io)?;
        Ok((
            Self {
                supervisor,
                released: false,
            },
            child,
        ))
    }

    pub fn verify_policy_and_release(&mut self, timeout: Duration) -> Result<(), SandboxError> {
        if self.released {
            return Err(SandboxError::Enforcement(
                "mission start gate has already been released".into(),
            ));
        }
        self.supervisor.set_read_timeout(Some(timeout))?;
        let mut ready = [0u8; 1];
        self.supervisor.read_exact(&mut ready).map_err(|error| {
            SandboxError::Enforcement(format!(
                "worker did not confirm enforced Landlock/seccomp policy: {error}"
            ))
        })?;
        if ready[0] != WORKER_POLICY_READY {
            return Err(SandboxError::Enforcement(
                "worker sent an invalid policy-ready token".into(),
            ));
        }
        self.supervisor.write_all(&[MISSION_RELEASE])?;
        self.supervisor.flush()?;
        self.released = true;
        Ok(())
    }
}

/// Worker-side final gate. This function must be called only after
/// `landlock_seccomp::enforce_worker` succeeds. It sends readiness, blocks for
/// the supervisor's explicit mission ACK, and closes FD 6 before returning.
pub fn worker_wait_for_supervisor_release() -> Result<(), SandboxError> {
    let mut stream = unsafe { UnixStream::from_raw_fd(WORKER_POLICY_GATE_FD) };
    stream.write_all(&[WORKER_POLICY_READY])?;
    stream.flush()?;

    let mut release = [0u8; 1];
    stream.read_exact(&mut release).map_err(|error| {
        SandboxError::Enforcement(format!(
            "supervisor did not release the worker after policy verification: {error}"
        ))
    })?;
    if release[0] != MISSION_RELEASE {
        return Err(SandboxError::Enforcement(
            "invalid mission-release token".into(),
        ));
    }
    drop(stream);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io, thread};

    #[test]
    fn worker_gate_blocks_until_successful_cgroup_validation_ack() {
        let (mut gate, mut child) = StartGate::pair().expect("create gate pair");
        child
            .set_read_timeout(Some(Duration::from_millis(30)))
            .expect("set bounded test read");

        assert!(gate
            .release_after_check(|| {
                Err(SandboxError::Enforcement(
                    "simulated cgroup membership mismatch".into(),
                ))
            })
            .is_err());
        let mut byte = [0u8; 1];
        let error = child.read(&mut byte).expect_err("gate must remain closed");
        assert!(
            matches!(
                error.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
            ),
            "unexpected read error while gate closed: {error}"
        );

        gate.release_after_check(|| Ok(()))
            .expect("successful verification releases gate");
        child
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("set bounded release read");
        child.read_exact(&mut byte).expect("read release ACK");
        assert_eq!(byte[0], START_GATE_RELEASE);
    }

    #[test]
    fn start_gate_is_one_shot() {
        let (mut gate, mut child) = StartGate::pair().expect("create gate pair");
        gate.release_after_check(|| Ok(())).expect("first release");
        assert!(gate.release_after_check(|| Ok(())).is_err());
        let mut received = [0u8; 2];
        child
            .read_exact(&mut received[..1])
            .expect("exactly one release byte");
        assert_eq!(received[0], START_GATE_RELEASE);
        child
            .set_read_timeout(Some(Duration::from_millis(20)))
            .expect("set no-duplicate timeout");
        assert!(child.read(&mut received[1..]).is_err());
    }

    #[test]
    fn final_gate_releases_only_after_policy_ready_token() {
        let (mut supervisor, mut worker) =
            WorkerPolicyGate::pair().expect("create worker policy gate");
        worker
            .set_read_timeout(Some(Duration::from_secs(1)))
            .expect("bounded mission acknowledgement read");
        let join = thread::spawn(move || {
            worker
                .write_all(&[WORKER_POLICY_READY])
                .expect("worker reports verified policies");
            let mut token = [0u8; 1];
            worker
                .read_exact(&mut token)
                .expect("worker remains blocked pending mission ACK");
            assert_eq!(token[0], MISSION_RELEASE);
        });

        supervisor
            .verify_policy_and_release(Duration::from_secs(1))
            .expect("supervisor releases only verified worker");
        join.join().expect("worker handshake completed");
    }

    #[test]
    fn final_gate_rejects_invalid_policy_ready_token_without_releasing() {
        let (mut supervisor, mut worker) =
            WorkerPolicyGate::pair().expect("create worker policy gate");
        worker
            .set_read_timeout(Some(Duration::from_millis(30)))
            .expect("bounded test read");
        worker.write_all(&[0x00]).expect("send invalid ready token");
        assert!(supervisor
            .verify_policy_and_release(Duration::from_secs(1))
            .is_err());
        let mut token = [0u8; 1];
        assert!(worker.read_exact(&mut token).is_err());
    }
}
