//! RocksDB storage backend

use rocksdb::{DB, Options, IteratorMode};
use std::path::Path;
use crate::{Error, Result};

const EVENT_LOG_CF: &str = "event_log";
const INDEX_CF: &str = "index";

/// RocksDB storage engine
pub struct Storage {
    db: DB,
}

impl Storage {
    /// Open or create a storage instance
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let cf_names = vec![EVENT_LOG_CF, INDEX_CF];
        let db = DB::open_cf(&opts, path, cf_names)?;

        Ok(Self { db })
    }

    /// Append an event to the log
    pub fn append(&self, key: &str, value: &[u8]) -> Result<()> {
        self.db.put_cf(
            self.db.cf_handle(EVENT_LOG_CF)
                .ok_or_else(|| Error::Storage("column family not found".to_string()))?,
            key.as_bytes(),
            value,
        )?;
        Ok(())
    }

    /// Get an event by ID
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        self.db.get_cf(
            self.db.cf_handle(EVENT_LOG_CF)
                .ok_or_else(|| Error::Storage("column family not found".to_string()))?,
            key.as_bytes(),
        ).map_err(|e| Error::Storage(e.to_string()))
    }

    /// Get all events for an aggregate ID (prefix scan)
    pub fn get_by_aggregate(&self, aggregate_id: &str) -> Result<Vec<Vec<u8>>> {
        let cf = self.db.cf_handle(EVENT_LOG_CF)
            .ok_or_else(|| Error::Storage("column family not found".to_string()))?;

        let prefix = format!("{}:", aggregate_id);
        let iter = self.db.iterator_cf(cf, IteratorMode::From(prefix.as_bytes(), true));

        let mut results = Vec::new();
        for (key, value) in iter {
            let key_str = String::from_utf8_lossy(&key);
            if !key_str.starts_with(&prefix) {
                break;
            }
            results.push(value.to_vec());
        }

        Ok(results)
    }

    /// Get events in range [from_timestamp, to_timestamp]
    pub fn get_by_range(&self, from: u64, to: u64) -> Result<Vec<Vec<u8>>> {
        let cf = self.db.cf_handle(EVENT_LOG_CF)
            .ok_or_else(|| Error::Storage("column family not found".to_string()))?;

        let from_key = format!("t:{:020}", from);
        let to_key = format!("t:{:020}", to);
        let iter = self.db.iterator_cf(cf, IteratorMode::From(from_key.as_bytes(), true));

        let mut results = Vec::new();
        for (key, value) in iter {
            let key_str = String::from_utf8_lossy(&key);
            if key_str > to_key {
                break;
            }
            results.push(value.to_vec());
        }

        Ok(results)
    }

    /// Count total events
    pub fn count(&self) -> Result<u64> {
        let cf = self.db.cf_handle(EVENT_LOG_CF)
            .ok_or_else(|| Error::Storage("column family not found".to_string()))?;

        let mut count = 0u64;
        let iter = self.db.iterator_cf(cf, IteratorMode::from_start());
        for _ in iter {
            count += 1;
        }
        Ok(count)
    }

    /// Compact the database
    pub fn compact(&self) -> Result<()> {
        self.db.compact_range(None::<&[u8]>, None::<&[u8]>);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_storage_append_and_get() {
        let tmp = TempDir::new().unwrap();
        let storage = Storage::open(tmp.path()).unwrap();

        storage.append("event:1", b"test-data").unwrap();
        let result = storage.get("event:1").unwrap();

        assert_eq!(result, Some(b"test-data".to_vec()));
    }

    #[test]
    fn test_storage_prefix_scan() {
        let tmp = TempDir::new().unwrap();
        let storage = Storage::open(tmp.path()).unwrap();

        storage.append("agg:123:event:1", b"data1").unwrap();
        storage.append("agg:123:event:2", b"data2").unwrap();
        storage.append("agg:124:event:1", b"data3").unwrap();

        let results = storage.get_by_aggregate("agg:123").unwrap();
        assert_eq!(results.len(), 2);
    }
}
