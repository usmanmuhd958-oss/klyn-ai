//! KLYN daemon IPC router and lifecycle gate.
//!
//! Every recognized IPC operation is validated and authorized before dispatch.
//! No operation executes if the policy engine fails, the protocol version is
//! unsupported, or the lifecycle is not Ready.

#![forbid(unsafe_code)]

pub mod lifecycle;
pub mod policy;
pub mod server;

use std::sync::Arc;

use klyn_protocol::{Method, ProtocolError, Request, Response, RpcErrorCode};
use serde_json::json;

use crate::{
    lifecycle::{Lifecycle, LifecycleError, RequestLease},
    policy::{PeerIdentity, PolicyEnforcer, PolicyError},
};

pub struct Router {
    lifecycle: Lifecycle,
    policy: Arc<dyn PolicyEnforcer>,
}

impl Router {
    pub fn new(lifecycle: Lifecycle, policy: Arc<dyn PolicyEnforcer>) -> Self {
        Self { lifecycle, policy }
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
        };

        (response, Some(lease))
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
