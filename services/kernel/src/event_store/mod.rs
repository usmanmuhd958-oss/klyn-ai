//! Append-only event log with RocksDB backend

mod event;
mod storage;
mod log;

pub use event::{Event, EventData, EventMetadata};
pub use log::EventLog;

#[cfg(test)]
mod tests;
