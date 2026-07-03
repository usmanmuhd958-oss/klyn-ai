//! Resource ledger for tracking execution artifacts

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use crate::Result;

/// Resource entry in the ledger
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResourceEntry {
    pub id: String,
    pub resource_type: String,
    pub owner: String,
    pub created_at: u64,
    pub metadata: HashMap<String, String>,
    pub hash: String,
}

/// Resource ledger
pub struct ResourceLedger {
    entries: Arc<RwLock<HashMap<String, ResourceEntry>>>,
    index: Arc<RwLock<HashMap<String, Vec<String>>>>, // type -> [ids]
}

impl ResourceLedger {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Record a resource
    pub fn record(&self, entry: ResourceEntry) -> Result<()> {
        let entry_id = entry.id.clone();
        let resource_type = entry.resource_type.clone();

        self.entries.write().insert(entry_id.clone(), entry);

        let mut index = self.index.write();
        index.entry(resource_type)
            .or_insert_with(Vec::new)
            .push(entry_id);

        Ok(())
    }

    /// Get a resource entry
    pub fn get(&self, id: &str) -> Result<Option<ResourceEntry>> {
        Ok(self.entries.read().get(id).cloned())
    }

    /// Get all resources of a type
    pub fn get_by_type(&self, resource_type: &str) -> Result<Vec<ResourceEntry>> {
        let entries = self.entries.read();
        let index = self.index.read();

        match index.get(resource_type) {
            Some(ids) => {
                let results = ids
                    .iter()
                    .filter_map(|id| entries.get(id).cloned())
                    .collect();
                Ok(results)
            }
            None => Ok(Vec::new()),
        }
    }

    /// Get all resources for an owner
    pub fn get_by_owner(&self, owner: &str) -> Result<Vec<ResourceEntry>> {
        let entries = self.entries.read();
        let results = entries
            .values()
            .filter(|e| e.owner == owner)
            .cloned()
            .collect();
        Ok(results)
    }

    /// Total resource count
    pub fn count(&self) -> Result<usize> {
        Ok(self.entries.read().len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ledger_record_and_get() {
        let ledger = ResourceLedger::new();
        let entry = ResourceEntry {
            id: "res:1".to_string(),
            resource_type: "code_bundle".to_string(),
            owner: "exec:1".to_string(),
            created_at: 1000,
            metadata: HashMap::new(),
            hash: "abc123".to_string(),
        };

        ledger.record(entry.clone()).unwrap();
        let retrieved = ledger.get("res:1").unwrap();
        assert_eq!(retrieved, Some(entry));
    }

    #[test]
    fn test_ledger_by_type() {
        let ledger = ResourceLedger::new();

        for i in 1..=3 {
            let entry = ResourceEntry {
                id: format!("res:{}", i),
                resource_type: "code_bundle".to_string(),
                owner: "exec:1".to_string(),
                created_at: 1000 + i,
                metadata: HashMap::new(),
                hash: format!("hash{}", i),
            };
            ledger.record(entry).unwrap();
        }

        let results = ledger.get_by_type("code_bundle").unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_ledger_by_owner() {
        let ledger = ResourceLedger::new();

        for i in 1..=2 {
            let entry = ResourceEntry {
                id: format!("res:{}", i),
                resource_type: "code_bundle".to_string(),
                owner: "exec:1".to_string(),
                created_at: 1000 + i,
                metadata: HashMap::new(),
                hash: format!("hash{}", i),
            };
            ledger.record(entry).unwrap();
        }

        let entry3 = ResourceEntry {
            id: "res:3".to_string(),
            resource_type: "code_bundle".to_string(),
            owner: "exec:2".to_string(),
            created_at: 1003,
            metadata: HashMap::new(),
            hash: "hash3".to_string(),
        };
        ledger.record(entry3).unwrap();

        let results = ledger.get_by_owner("exec:1").unwrap();
        assert_eq!(results.len(), 2);
    }
}
