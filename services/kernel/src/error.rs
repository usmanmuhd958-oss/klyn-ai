//! Error types for the kernel

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("storage error: {0}")]
    Storage(String),

    #[error("event not found: {0}")]
    EventNotFound(String),

    #[error("snapshot error: {0}")]
    Snapshot(String),

    #[error("replay error: {0}")]
    Replay(String),

    #[error("raft error: {0}")]
    Raft(String),

    #[error("capability denied: {0}")]
    CapabilityDenied(String),

    #[error("ledger error: {0}")]
    Ledger(String),

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("rocksdb error: {0}")]
    RocksDb(#[from] rocksdb::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
