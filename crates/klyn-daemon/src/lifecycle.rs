//! Explicit daemon state transitions and drain accounting.

use std::{
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    Starting,
    Ready,
    Draining,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct LifecycleSnapshot {
    pub state: LifecycleState,
    pub in_flight_requests: usize,
    pub active_connections: usize,
    pub failure: Option<String>,
}

#[derive(Debug)]
struct StateData {
    state: LifecycleState,
    in_flight_requests: usize,
    active_connections: usize,
    failure: Option<String>,
}

#[derive(Debug)]
struct LifecycleInner {
    data: Mutex<StateData>,
    changed: Condvar,
}

#[derive(Clone)]
pub struct Lifecycle {
    inner: Arc<LifecycleInner>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LifecycleError {
    #[error("invalid lifecycle transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: LifecycleState,
        to: LifecycleState,
    },
    #[error("daemon is not ready")]
    NotReady,
    #[error("daemon is draining and rejects new work")]
    ShuttingDown,
    #[error("daemon has failed")]
    Failed,
    #[error("shutdown drain deadline expired")]
    DrainTimeout,
    #[error("lifecycle synchronization primitive is poisoned")]
    LockPoisoned,
}

impl Lifecycle {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(LifecycleInner {
                data: Mutex::new(StateData {
                    state: LifecycleState::Starting,
                    in_flight_requests: 0,
                    active_connections: 0,
                    failure: None,
                }),
                changed: Condvar::new(),
            }),
        }
    }

    pub fn snapshot(&self) -> Result<LifecycleSnapshot, LifecycleError> {
        let data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        Ok(LifecycleSnapshot {
            state: data.state,
            in_flight_requests: data.in_flight_requests,
            active_connections: data.active_connections,
            failure: data.failure.clone(),
        })
    }

    pub fn mark_ready(&self) -> Result<(), LifecycleError> {
        let mut data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        if data.state != LifecycleState::Starting {
            return Err(LifecycleError::InvalidTransition {
                from: data.state,
                to: LifecycleState::Ready,
            });
        }
        data.state = LifecycleState::Ready;
        self.inner.changed.notify_all();
        Ok(())
    }

    pub fn begin_request(&self) -> Result<RequestLease, LifecycleError> {
        let mut data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        match data.state {
            LifecycleState::Ready => {
                data.in_flight_requests = data
                    .in_flight_requests
                    .checked_add(1)
                    .ok_or(LifecycleError::Failed)?;
                Ok(RequestLease {
                    inner: Arc::clone(&self.inner),
                    active: true,
                })
            }
            LifecycleState::Draining => Err(LifecycleError::ShuttingDown),
            LifecycleState::Failed => Err(LifecycleError::Failed),
            LifecycleState::Starting | LifecycleState::Stopped => Err(LifecycleError::NotReady),
        }
    }

    /// Tracks accepted connections separately from authorized operations so a
    /// shutdown cannot report Stopped while a response is still being written.
    pub fn begin_connection(&self) -> Result<ConnectionLease, LifecycleError> {
        let mut data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        match data.state {
            LifecycleState::Ready | LifecycleState::Draining => {
                data.active_connections = data
                    .active_connections
                    .checked_add(1)
                    .ok_or(LifecycleError::Failed)?;
                Ok(ConnectionLease {
                    inner: Arc::clone(&self.inner),
                    active: true,
                })
            }
            LifecycleState::Failed => Err(LifecycleError::Failed),
            LifecycleState::Starting | LifecycleState::Stopped => Err(LifecycleError::NotReady),
        }
    }

    pub fn begin_draining(&self) -> Result<(), LifecycleError> {
        let mut data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        if data.state != LifecycleState::Ready {
            return Err(match data.state {
                LifecycleState::Draining => LifecycleError::ShuttingDown,
                LifecycleState::Failed => LifecycleError::Failed,
                LifecycleState::Starting | LifecycleState::Stopped => {
                    LifecycleError::InvalidTransition {
                        from: data.state,
                        to: LifecycleState::Draining,
                    }
                }
                LifecycleState::Ready => unreachable!(),
            });
        }
        data.state = LifecycleState::Draining;
        self.inner.changed.notify_all();
        Ok(())
    }

    pub fn fail(&self, reason: impl Into<String>) -> Result<(), LifecycleError> {
        let mut data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        match data.state {
            LifecycleState::Stopped => {
                return Err(LifecycleError::InvalidTransition {
                    from: data.state,
                    to: LifecycleState::Failed,
                });
            }
            LifecycleState::Failed => return Ok(()),
            _ => {}
        }
        let reason: String = reason.into().chars().take(256).collect();
        data.failure = Some(reason);
        data.state = LifecycleState::Failed;
        self.inner.changed.notify_all();
        Ok(())
    }

    /// Only transitions Draining -> Stopped after all accepted connections and
    /// authorized requests have completed. Timeout transitions to Failed.
    pub fn complete_shutdown(&self, timeout: Duration) -> Result<(), LifecycleError> {
        let data = self
            .inner
            .data
            .lock()
            .map_err(|_| LifecycleError::LockPoisoned)?;
        if data.state != LifecycleState::Draining {
            return Err(LifecycleError::InvalidTransition {
                from: data.state,
                to: LifecycleState::Stopped,
            });
        }

        let (mut data, timed_out) = self
            .inner
            .changed
            .wait_timeout_while(data, timeout, |data| {
                data.state == LifecycleState::Draining
                    && (data.in_flight_requests != 0 || data.active_connections != 0)
            })
            .map_err(|_| LifecycleError::LockPoisoned)?;

        if data.state == LifecycleState::Failed {
            return Err(LifecycleError::Failed);
        }
        if data.state != LifecycleState::Draining {
            return Err(LifecycleError::InvalidTransition {
                from: data.state,
                to: LifecycleState::Stopped,
            });
        }

        if timed_out.timed_out() && (data.in_flight_requests != 0 || data.active_connections != 0) {
            data.state = LifecycleState::Failed;
            data.failure = Some("shutdown drain deadline expired".to_owned());
            self.inner.changed.notify_all();
            return Err(LifecycleError::DrainTimeout);
        }

        data.state = LifecycleState::Stopped;
        self.inner.changed.notify_all();
        Ok(())
    }
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub struct RequestLease {
    inner: Arc<LifecycleInner>,
    active: bool,
}

impl Drop for RequestLease {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Ok(mut data) = self.inner.data.lock() {
            if data.in_flight_requests > 0 {
                data.in_flight_requests -= 1;
            } else {
                data.state = LifecycleState::Failed;
                data.failure = Some("request lease accounting invariant violated".to_owned());
            }
            if data.in_flight_requests == 0 && data.active_connections == 0 {
                self.inner.changed.notify_all();
            }
        }
        self.active = false;
    }
}

#[derive(Debug)]
pub struct ConnectionLease {
    inner: Arc<LifecycleInner>,
    active: bool,
}

impl Drop for ConnectionLease {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Ok(mut data) = self.inner.data.lock() {
            if data.active_connections > 0 {
                data.active_connections -= 1;
            } else {
                data.state = LifecycleState::Failed;
                data.failure = Some("connection lease accounting invariant violated".to_owned());
            }
            if data.in_flight_requests == 0 && data.active_connections == 0 {
                self.inner.changed.notify_all();
            }
        }
        self.active = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_requires_starting_to_ready_before_work() {
        let lifecycle = Lifecycle::new();
        assert_eq!(
            lifecycle.begin_request().unwrap_err(),
            LifecycleError::NotReady
        );
        lifecycle.mark_ready().unwrap();
        assert!(lifecycle.begin_request().is_ok());
    }

    #[test]
    fn invalid_transitions_are_rejected() {
        let lifecycle = Lifecycle::new();
        assert!(matches!(
            lifecycle.begin_draining(),
            Err(LifecycleError::InvalidTransition { .. })
        ));
        lifecycle.mark_ready().unwrap();
        lifecycle.begin_draining().unwrap();
        assert_eq!(
            lifecycle.begin_request().unwrap_err(),
            LifecycleError::ShuttingDown
        );
    }

    #[test]
    fn shutdown_waits_for_request_and_connection_leases() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let request = lifecycle.begin_request().unwrap();
        let connection = lifecycle.begin_connection().unwrap();
        lifecycle.begin_draining().unwrap();
        drop(request);
        drop(connection);
        lifecycle
            .complete_shutdown(Duration::from_millis(10))
            .unwrap();
        assert_eq!(lifecycle.snapshot().unwrap().state, LifecycleState::Stopped);
    }

    #[test]
    fn drain_timeout_fails_closed() {
        let lifecycle = Lifecycle::new();
        lifecycle.mark_ready().unwrap();
        let connection = lifecycle.begin_connection().unwrap();
        lifecycle.begin_draining().unwrap();
        assert_eq!(
            lifecycle.complete_shutdown(Duration::ZERO).unwrap_err(),
            LifecycleError::DrainTimeout
        );
        assert_eq!(lifecycle.snapshot().unwrap().state, LifecycleState::Failed);
        drop(connection);
    }
}
