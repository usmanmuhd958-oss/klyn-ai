//! KLYN daemon IPC router and lifecycle gate.
//!
//! Every recognized IPC operation is validated and authorized before dispatch.
//! No operation executes if the policy engine fails, the protocol version is
//! unsupported, or the lifecycle is not Ready.

#![forbid(unsafe_code)]

pub mod execution;
pub mod fs_service;
pub mod lifecycle;
pub mod policy;
pub mod server;

use std::sync::Arc;

use klyn_fs::FsError;
use klyn_protocol::{
    ExecuteTaskParams, Method, ProtocolError, Request, Response, RpcErrorCode,
};
use serde_json::json;

use crate::{
    execution::{ExecutionError, ExecutionService},
    fs_service::{FsService, FsServiceError},
    lifecycle::{Lifecycle, LifecycleError, RequestLease},
    policy::{PeerIdentity, PolicyEnforcer, PolicyError},
};

pub struct Router {
    lifecycle: Lifecycle,
    policy: Arc<dyn PolicyEnforcer>,
    fs: Option<Arc<FsService>>,
    execution: Option<Arc<ExecutionService>>,
}

impl Router {
    pub fn new(lifecycle: Lifecycle, policy: Arc<dyn PolicyEnforcer>) -> Self {
        Self {
            lifecycle,
            policy,
            fs: None,
            execution: None,
        }
    }

    pub fn with_fs(
        lifecycle: Lifecycle,
        policy: Arc<dyn PolicyEnforcer>,
        fs: Arc<FsService>,
    ) -> Self {
        Self {
            lifecycle,
            policy,
            fs: Some(fs),
            execution: None,
        }
    }

    /// Install the only IPC task-execution path. If omitted, ExecuteTask is denied
    /// with an unavailable response; there is no unsandboxed fallback.
    pub fn with_execution(mut self, execution: Arc<ExecutionService>) -> Self {
        self.execution = Some(execution);
        self
    }

    pub fn lifecycle(&self) -> Lifecycle {
        self.lifecycle.clone()
    }

    /// Public in-process entry point. The lease is released after a response
    /// object is produced; the socket server uses dispatch_with_lease so the
    /// lease remains alive until the response has been written.
    pub fn dispatch(&self, request: Request, peer: PeerIdentity) -> Response {
        let (response, lease) = self.dispatch_with_lease(request, peer);
        drop(lease);
        response
    }

    pub(crate) fn dispatch_with_lease(
        &self,
        request: Request,
        peer: PeerIdentity,
    ) -> (Response, Option<RequestLease>) {
        let request_id = request.request_id;

        if let Err(error) = request.validate() {
            let response = match error {
                ProtocolError::UnsupportedVersion { .. } => Response::failure(
                    Some(request_id),
                    RpcErrorCode::UnsupportedVersion,
                    "unsupported protocol version",
                ),
                ProtocolError::InvalidJson(_)
                | ProtocolError::InvalidRequestId
                | ProtocolError::InvalidParams => Response::failure(
                    Some(request_id),
                    RpcErrorCode::InvalidRequest,
                    "invalid request",
                ),
            };
            return (response, None);
        }

        if let Err(error) = self.policy.authorize(peer, request.method) {
            return match error {
                PolicyError::Denied => (
                    Response::failure(
                        Some(request_id),
                        RpcErrorCode::Unauthorized,
                        "request denied by policy",
                    ),
                    None,
                ),
                PolicyError::Unavailable => {
                    let _ = self.lifecycle.fail("policy evaluation unavailable");
                    (
                        Response::failure(
                            Some(request_id),
                            RpcErrorCode::PolicyUnavailable,
                            "policy enforcement unavailable; daemon failed closed",
                        ),
                        None,
                    )
                }
            };
        }

        let lease = match self.lifecycle.begin_request() {
            Ok(lease) => lease,
            Err(error) => {
                return (lifecycle_error_response(Some(request_id), error), None);
            }
        };

        let response = match request.method {
            Method::Ping => Response::success(request_id, json!({"pong": true})),
            Method::DaemonStatus => match self.lifecycle.snapshot() {
                Ok(snapshot) => match serde_json::to_value(snapshot) {
                    Ok(value) => Response::success(request_id, value),
                    Err(_) => Response::failure(
                        Some(request_id),
                        RpcErrorCode::Internal,
                        "internal daemon error",
                    ),
                },
                Err(_) => Response::failure(
                    Some(request_id),
                    RpcErrorCode::Internal,
                    "lifecycle state unavailable",
                ),
            },
            Method::DaemonShutdown => match self.lifecycle.begin_draining() {
                Ok(()) => Response::success(request_id, json!({"state": "draining"})),
                Err(error) => lifecycle_error_response(Some(request_id), error),
            },
            Method::FsBegin
            | Method::FsWriteFile
            | Method::FsStage
            | Method::FsValidate
            | Method::FsCommit
            | Method::FsAbort => match &self.fs {
                None => Response::failure(
                    Some(request_id),
                    RpcErrorCode::FilesystemUnavailable,
                    "filesystem transaction service is unavailable",
                ),
                Some(service) => match service.execute(peer, request.method, &request.params) {
                    Ok(result) => Response::success(request_id, result),
                    Err(error) => filesystem_error_response(Some(request_id), error),
                },
            },
            Method::ExecuteTask => {
                let params = match serde_json::from_value::<ExecuteTaskParams>(request.params) {
                    Ok(params) => params,
                    Err(_) => {
                        return (
                            Response::failure(
                                Some(request_id),
                                RpcErrorCode::InvalidRequest,
                                "invalid task parameters",
                            ),
                            Some(lease),
                        );
                    }
                };
                match &self.execution {
                    None => Response::failure(
                        Some(request_id),
                        RpcErrorCode::ExecutionUnavailable,
                        "sandbox execution service is unavailable; task was not run",
                    ),
                    Some(service) => match service.execute(peer, params) {
                        Ok(result) => match serde_json::to_value(result) {
                            Ok(value) => Response::success(request_id, value),
                            Err(_) => Response::failure(
                                Some(request_id),
                                RpcErrorCode::ExecutionFailed,
                                "sandbox worker returned an invalid result",
                            ),
                        },
                        Err(ExecutionError::Timeout) => Response::failure(
                            Some(request_id),
                            RpcErrorCode::ExecutionTimeout,
                            "sandbox task exceeded its execution deadline",
                        ),
                        Err(ExecutionError::InvalidTask) => Response::failure(
                            Some(request_id),
                            RpcErrorCode::InvalidRequest,
                            "task parameters are invalid",
                        ),
                        Err(_) => Response::failure(
                            Some(request_id),
                            RpcErrorCode::ExecutionFailed,
                            "sandbox task failed closed",
                        ),
                    },
                }
            }
        };

        (response, Some(lease))
    }
}

fn filesystem_error_response(request_id: Option<u64>, error: FsServiceError) -> Response {
    match error {
        // Do not reveal whether another UID's transaction ID exists.
        FsServiceError::NotFound | FsServiceError::PermissionDenied => Response::failure(
            request_id,
            RpcErrorCode::Unauthorized,
            "filesystem transaction is unavailable or the caller is not authorized",
        ),
        FsServiceError::InvalidParameters => Response::failure(
            request_id,
            RpcErrorCode::InvalidState,
            "filesystem transaction or parameters are invalid",
        ),
        FsServiceError::RegistryUnavailable => Response::failure(
            request_id,
            RpcErrorCode::FilesystemUnavailable,
            "filesystem transaction registry is unavailable",
        ),
        FsServiceError::Engine(error) => match error {
            FsError::Conflict { .. } | FsError::WriteConflict => Response::failure(
                request_id,
                RpcErrorCode::Conflict,
                "revision or file precondition conflict",
            ),
            FsError::PathEscape
            | FsError::SymlinkRejected
            | FsError::InvalidPathType
            | FsError::MutationTooLarge => Response::failure(
                request_id,
                RpcErrorCode::InvalidPath,
                "candidate path or mutation rejected",
            ),
            FsError::WrongState { .. }
            | FsError::InvalidTransition { .. }
            | FsError::EmptyTransaction
            | FsError::LinkOrSubmoduleChange => Response::failure(
                request_id,
                RpcErrorCode::InvalidState,
                "filesystem transaction state or staged content is invalid",
            ),
            FsError::PublishedButJournalIncomplete { .. }
            | FsError::PublishedCleanupPending { .. } => Response::failure(
                request_id,
                RpcErrorCode::FilesystemUnavailable,
                "publication succeeded; journal reconciliation or candidate cleanup is required",
            ),
            _ => Response::failure(
                request_id,
                RpcErrorCode::FilesystemUnavailable,
                "filesystem transaction failed closed",
            ),
        },
    }
}

fn lifecycle_error_response(request_id: Option<u64>, error: LifecycleError) -> Response {
    match error {
        LifecycleError::ShuttingDown => {
            Response::failure(request_id, RpcErrorCode::ShuttingDown, "daemon is draining")
        }
        LifecycleError::NotReady => {
            Response::failure(request_id, RpcErrorCode::NotReady, "daemon is not ready")
        }
        LifecycleError::Failed
        | LifecycleError::DrainTimeout
        | LifecycleError::LockPoisoned
        | LifecycleError::InvalidTransition { .. } => Response::failure(
            request_id,
            RpcErrorCode::Internal,
            "daemon lifecycle enforcement failed",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{Permission, UidPolicy};
    use klyn_protocol::{Method, Request, PROTOCOL_VERSION};
    use serde_json::json;

    fn request(method: Method, params: serde_json::Value) -> Request {
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 11,
            method,
            params,
        }
    }

    fn peer(uid: u32) -> PeerIdentity {
        PeerIdentity {
            pid: 5,
            uid,
            gid: 5,
        }
    }

    #[test]
    fn execute_task_is_denied_without_permission() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let router = Router::new(lifecycle.clone(), Arc::new(UidPolicy::new()));
        let response = router.dispatch(
            request(Method::ExecuteTask, json!({
                "task_id": "task-unauthorized",
                "operation": "hash_json",
                "payload": {"value": 1}
            })),
            peer(1000),
        );
        assert_eq!(response.error.unwrap().code, RpcErrorCode::Unauthorized);
        assert_eq!(lifecycle.snapshot().unwrap().in_flight_requests, 0);
    }

    #[test]
    fn execute_task_fails_closed_when_supervisor_is_not_configured() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let policy = UidPolicy::from_grants([(1000, Permission::ExecuteTask)]);
        let router = Router::new(lifecycle.clone(), Arc::new(policy));
        let response = router.dispatch(
            request(Method::ExecuteTask, json!({
                "task_id": "task-no-supervisor",
                "operation": "hash_json",
                "payload": {"value": 1}
            })),
            peer(1000),
        );
        assert_eq!(response.error.unwrap().code, RpcErrorCode::ExecutionUnavailable);
        assert_eq!(lifecycle.snapshot().unwrap().in_flight_requests, 0);
    }

    #[test]
    fn unauthorized_request_never_enters_lifecycle_dispatch() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let router = Router::new(lifecycle.clone(), Arc::new(UidPolicy::new()));
        let response = router.dispatch(request(Method::Ping, json!({})), peer(1000));
        assert_eq!(response.error.unwrap().code, RpcErrorCode::Unauthorized);
        assert_eq!(lifecycle.snapshot().unwrap().in_flight_requests, 0);
    }

    #[test]
    fn policy_engine_failure_marks_daemon_failed() {
        struct BrokenPolicy;
        impl PolicyEnforcer for BrokenPolicy {
            fn authorize(&self, _peer: PeerIdentity, _method: Method) -> Result<(), PolicyError> {
                Err(PolicyError::Unavailable)
            }
        }

        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let router = Router::new(lifecycle.clone(), Arc::new(BrokenPolicy));
        let response = router.dispatch(request(Method::Ping, json!({})), peer(1000));
        assert_eq!(
            response.error.unwrap().code,
            RpcErrorCode::PolicyUnavailable
        );
        assert_eq!(
            lifecycle.snapshot().unwrap().state,
            lifecycle::LifecycleState::Failed
        );
    }

    #[test]
    fn shutdown_requires_its_own_capability_and_drains() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let mut policy = UidPolicy::new();
        policy.grant(1000, Permission::ShutdownDaemon);
        let router = Router::new(lifecycle.clone(), Arc::new(policy));

        let response = router.dispatch(request(Method::DaemonShutdown, json!({})), peer(1000));
        assert_eq!(response.result.unwrap()["state"], "draining");
        lifecycle
            .complete_shutdown(std::time::Duration::from_millis(10))
            .unwrap();
        assert_eq!(
            lifecycle.snapshot().unwrap().state,
            lifecycle::LifecycleState::Stopped
        );
    }
}
