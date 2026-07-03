//! KLYN AI OS Event-Sourced Kernel
//!
//! A production-grade event sourcing implementation with:
//! - Append-only log storage (RocksDB)
//! - Raft consensus abstraction
//! - Snapshot management
//! - Deterministic replay
//! - Capability-based security
//! - Resource ledger

pub mod event_store;
pub mod snapshot;
pub mod replay;
pub mod scheduler;
pub mod capability;
pub mod ledger;
pub mod raft;
pub mod error;

pub use error::{Error, Result};
