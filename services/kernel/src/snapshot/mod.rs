//! Snapshot manager for checkpoint and restore

use crate::event_store::Event;
use crate::{Error, Result};
use rocksdb::DB;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Snapshot metadata
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SnapshotMetadata {
    pub id: String,
    pub timestamp: u64,
    pub sequence: u64,
    pub state_hash: String,
}

/// Snapshot state
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub metadata: SnapshotMetadata,
    pub state: std::collections::HashMap<String, serde_json::Value>,
}

/// Snapshot manager
pub struct SnapshotManager {
    db: DB,
}

impl SnapshotManager {
    /// Create a new snapshot manager
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut opts = rocksdb::Options::default();
        opts.create_if_missing(true);
        let db = DB::open(&opts, path.as_ref().join("snapshots"))?;
        Ok(Self { db })
    }

    /// Save a snapshot
    pub fn save(&self, snapshot: &Snapshot) -> Result<()> {
        let json = serde_json::to_string(snapshot)?;
        self.db.put(snapshot.metadata.id.as_bytes(), json.as_bytes())?;
        Ok(())
    }

    /// Load a snapshot
    pub fn load(&self, id: &str) -> Result<Option<Snapshot>> {
        match self.db.get(id.as_bytes())? {
            Some(bytes) => {
                let snapshot = serde_json::from_slice(&bytes)?;
                Ok(Some(snapshot))
            }
            None => Ok(None),
        }
    }

    /// Delete a snapshot
    pub fn delete(&self, id: &str) -> Result<()> {
        self.db.delete(id.as_bytes())?;
        Ok(())
    }

    /// Get latest snapshot
    pub fn latest(&self) -> Result<Option<Snapshot>> {
        let iter = self.db.iterator(rocksdb::IteratorMode::End);
        for (_, value) in iter.take(1) {
            let snapshot: Snapshot = serde_json::from_slice(&value)?;
            return Ok(Some(snapshot));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_snapshot_save_load() {
        let tmp = TempDir::new().unwrap();
        let manager = SnapshotManager::new(tmp.path()).unwrap();

        let mut state = std::collections::HashMap::new();
        state.insert("key".to_string(), serde_json::json!("value"));

        let snapshot = Snapshot {
            metadata: SnapshotMetadata {
                id: "snap:1".to_string(),
                timestamp: 1000,
                sequence: 100,
                state_hash: "abc123".to_string(),
            },
            state,
        };

        manager.save(&snapshot).unwrap();
        let loaded = manager.load("snap:1").unwrap();
        assert!(loaded.is_some());
    }
}
