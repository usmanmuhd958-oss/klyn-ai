//! Kernel-authenticated peer identity and deny-by-default authorization.

use std::collections::{BTreeMap, BTreeSet};

use klyn_protocol::Method;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PeerIdentity {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Permission {
    ObserveDaemon,
    ShutdownDaemon,
    FsBeginCandidate,
    FsMutateCandidate,
    FsValidateCandidate,
    FsPublishRevision,
    FsAbortCandidate,
    ExecuteTask,
}

impl Permission {
    pub fn for_method(method: Method) -> Self {
        match method {
            Method::Ping | Method::DaemonStatus => Self::ObserveDaemon,
            Method::DaemonShutdown => Self::ShutdownDaemon,
            Method::FsBegin => Self::FsBeginCandidate,
            Method::FsWriteFile | Method::FsStage => Self::FsMutateCandidate,
            Method::FsValidate => Self::FsValidateCandidate,
            Method::FsCommit => Self::FsPublishRevision,
            Method::FsAbort => Self::FsAbortCandidate,
            Method::ExecuteTask => Self::ExecuteTask,
        }
    }
}

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("request denied by policy")]
    Denied,
    #[error("policy evaluation is unavailable")]
    Unavailable,
}

pub trait PolicyEnforcer: Send + Sync {
    /// Implementations must fail closed. An error other than Denied indicates
    /// an unavailable policy engine and causes the daemon to enter Failed.
    fn authorize(&self, peer: PeerIdentity, method: Method) -> Result<(), PolicyError>;
}

#[derive(Clone, Debug, Default)]
pub struct UidPolicy {
    grants: BTreeMap<u32, BTreeSet<Permission>>,
}

impl UidPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn grant(&mut self, uid: u32, permission: Permission) {
        self.grants.entry(uid).or_default().insert(permission);
    }

    pub fn from_grants(grants: impl IntoIterator<Item = (u32, Permission)>) -> Self {
        let mut policy = Self::new();
        for (uid, permission) in grants {
            policy.grant(uid, permission);
        }
        policy
    }
}

impl PolicyEnforcer for UidPolicy {
    fn authorize(&self, peer: PeerIdentity, method: Method) -> Result<(), PolicyError> {
        let required = Permission::for_method(method);
        if self
            .grants
            .get(&peer.uid)
            .is_some_and(|permissions| permissions.contains(&required))
        {
            Ok(())
        } else {
            Err(PolicyError::Denied)
        }
    }
}

/// Safe bootstrap policy. Until an explicit policy is installed, no operation
/// is authorized, including ping and status.
#[derive(Clone, Copy, Debug, Default)]
pub struct DenyAllPolicy;

impl PolicyEnforcer for DenyAllPolicy {
    fn authorize(&self, _peer: PeerIdentity, _method: Method) -> Result<(), PolicyError> {
        Err(PolicyError::Denied)
    }
}

#[cfg(test)]
mod execution_policy_tests {
    use super::*;

    #[test]
    fn task_execution_requires_its_own_permission() {
        let peer = PeerIdentity {
            pid: 5,
            uid: 1000,
            gid: 1000,
        };
        let mut policy = UidPolicy::new();
        policy.grant(1000, Permission::ObserveDaemon);
        assert_eq!(
            policy.authorize(peer, Method::ExecuteTask),
            Err(PolicyError::Denied)
        );
        policy.grant(1000, Permission::ExecuteTask);
        assert_eq!(policy.authorize(peer, Method::ExecuteTask), Ok(()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(uid: u32) -> PeerIdentity {
        PeerIdentity {
            pid: 123,
            uid,
            gid: 456,
        }
    }

    #[test]
    fn policy_requires_an_explicit_uid_grant() {
        let mut policy = UidPolicy::new();
        policy.grant(1000, Permission::ObserveDaemon);
        assert!(policy.authorize(peer(1000), Method::Ping).is_ok());
        assert_eq!(
            policy.authorize(peer(1001), Method::Ping),
            Err(PolicyError::Denied)
        );
    }

    #[test]
    fn shutdown_requires_a_distinct_permission() {
        let mut policy = UidPolicy::new();
        policy.grant(1000, Permission::ObserveDaemon);
        assert_eq!(
            policy.authorize(peer(1000), Method::DaemonShutdown),
            Err(PolicyError::Denied)
        );
    }
}

#[cfg(test)]
mod fs_policy_tests {
    use super::*;

    #[test]
    fn filesystem_publication_requires_its_own_permission() {
        let peer = PeerIdentity {
            pid: 21,
            uid: 1000,
            gid: 1000,
        };
        let mut policy = UidPolicy::new();
        policy.grant(1000, Permission::FsBeginCandidate);
        assert!(policy.authorize(peer, Method::FsBegin).is_ok());
        assert_eq!(
            policy.authorize(peer, Method::FsCommit),
            Err(PolicyError::Denied)
        );
    }
}
