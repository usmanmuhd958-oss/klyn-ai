//! One-shot supervisor-to-stage-0 start gate.
//!
//! The child endpoint is inherited as FD 5 by klyn-sandbox-init. That binary
//! accepts only the single RELEASE byte after it has validated its manifest;
//! the supervisor may send it only after cgroup membership and limits have
//! been independently read back.

use std::{
    io::Write,
    os::unix::net::UnixStream,
};

use ed25519_dalek::VerifyingKey;

use crate::{cgroup::CgroupV2Boundary, manifest::WorkerManifest, SandboxError};

pub const START_GATE_FD: i32 = 5;
pub const START_GATE_RELEASE: u8 = 0xA5;

pub struct StartGate {
    supervisor: UnixStream,
    released: bool,
}

impl StartGate {
    /// Return the supervisor endpoint and the child endpoint. Pass the child
    /// endpoint to Command::pre_exec and dup it to FD 5; then drop the
    /// supervisor's copy of the child endpoint before calling release.
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

    /// Attach a blocked process, verify its actual cgroup controls, bind those
    /// controls to the signed manifest, then and only then send the RELEASE ACK.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{self, Read}, time::Duration};

    #[test]
    fn worker_gate_blocks_until_successful_validation_ack() {
        let (mut gate, mut child) = StartGate::pair().expect("create gate pair");
        child
            .set_read_timeout(Some(Duration::from_millis(30)))
            .expect("set bounded test read");

        // A failed cgroup/policy check must not write any byte to the child.
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
}
