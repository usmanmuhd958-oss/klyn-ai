//! Event log with sequence numbering and consistency guarantees

use crate::event_store::{Event, EventData, EventMetadata};
use crate::{Error, Result};
use parking_lot::RwLock;
use std::sync::Arc;
use super::storage::Storage;

/// Event log with append-only semantics
pub struct EventLog {
    storage: Arc<Storage>,
    sequence: Arc<RwLock<u64>>,
    secret_key: Vec<u8>,
}

impl EventLog {
    /// Create a new event log
    pub fn new(storage: Arc<Storage>, secret_key: Vec<u8>) -> Self {
        Self {
            storage,
            sequence: Arc::new(RwLock::new(0)),
            secret_key,
        }
    }

    /// Append an event to the log
    pub fn append(&self, mut event: Event) -> Result<u64> {
        // Assign sequence number
        let mut seq = self.sequence.write();
        *seq += 1;
        event.timestamp = *seq;

        // Sign the event
        event.sign(&self.secret_key)?;

        // Serialize
        let json = serde_json::to_string(&event)?;

        // Store with composite key: timestamp:id
        let key = format!("t:{:020}:id:{}", event.timestamp, event.id);
        self.storage.append(&key, json.as_bytes())?;

        // Also index by aggregate ID
        let agg_key = format!("agg:{}:t:{:020}", event.aggregate_id, event.timestamp);
        self.storage.append(&agg_key, json.as_bytes())?;

        Ok(event.timestamp)
    }

    /// Get event by ID
    pub fn get(&self, event_id: &str) -> Result<Option<Event>> {
        // Scan for the event (TODO: optimize with secondary index)
        let count = self.storage.count()?;
        for i in 0..count {
            let key = format!("t:{:020}:id:{}", i, event_id);
            if let Some(bytes) = self.storage.get(&key)? {
                let event: Event = serde_json::from_slice(&bytes)?;
                return Ok(Some(event));
            }
        }
        Ok(None)
    }

    /// Get all events for an aggregate
    pub fn get_aggregate_events(&self, aggregate_id: &str) -> Result<Vec<Event>> {
        let bytes = self.storage.get_by_aggregate(aggregate_id)?;
        let mut events: Vec<Event> = bytes
            .iter()
            .filter_map(|b| serde_json::from_slice(b).ok())
            .collect();
        events.sort_by_key(|e| e.timestamp);
        Ok(events)
    }

    /// Get events in timestamp range
    pub fn get_by_range(&self, from: u64, to: u64) -> Result<Vec<Event>> {
        let bytes = self.storage.get_by_range(from, to)?;
        let mut events: Vec<Event> = bytes
            .iter()
            .filter_map(|b| serde_json::from_slice(b).ok())
            .collect();
        events.sort_by_key(|e| e.timestamp);
        Ok(events)
    }

    /// Get current sequence number
    pub fn current_sequence(&self) -> u64 {
        *self.sequence.read()
    }

    /// Compact the storage
    pub fn compact(&self) -> Result<()> {
        self.storage.compact()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn create_event_log() -> (EventLog, TempDir) {
        let tmp = TempDir::new().unwrap();
        let storage = Arc::new(Storage::open(tmp.path()).unwrap());
        let log = EventLog::new(storage, b"test-secret".to_vec());
        (log, tmp)
    }

    #[test]
    fn test_append_event() {
        let (log, _tmp) = create_event_log();
        let metadata = EventMetadata {
            user_id: "user:1".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        let event = Event::new(
            "exec:1".to_string(),
            "IntentSubmitted".to_string(),
            EventData::IntentSubmitted {
                intent_text: "test".to_string(),
                user_id: "user:1".to_string(),
            },
            metadata,
        );

        let seq = log.append(event).unwrap();
        assert_eq!(seq, 1);
    }

    #[test]
    fn test_sequence_increment() {
        let (log, _tmp) = create_event_log();
        let metadata = EventMetadata {
            user_id: "user:1".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        for i in 1..=5 {
            let event = Event::new(
                format!("exec:{}", i),
                "IntentSubmitted".to_string(),
                EventData::IntentSubmitted {
                    intent_text: format!("test {}", i),
                    user_id: "user:1".to_string(),
                },
                metadata.clone(),
            );
            let seq = log.append(event).unwrap();
            assert_eq!(seq, i as u64);
        }
    }

    #[test]
    fn test_get_aggregate_events() {
        let (log, _tmp) = create_event_log();
        let metadata = EventMetadata {
            user_id: "user:1".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        for i in 1..=3 {
            let event = Event::new(
                "exec:1".to_string(),
                "IntentSubmitted".to_string(),
                EventData::IntentSubmitted {
                    intent_text: format!("test {}", i),
                    user_id: "user:1".to_string(),
                },
                metadata.clone(),
            );
            log.append(event).unwrap();
        }

        let events = log.get_aggregate_events("exec:1").unwrap();
        assert_eq!(events.len(), 3);
    }
}
