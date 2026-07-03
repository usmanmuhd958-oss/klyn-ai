//! Deterministic replay engine

use crate::event_store::{Event, EventLog};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Replay state
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplayState {
    pub execution_id: String,
    pub variables: HashMap<String, serde_json::Value>,
    pub log_position: u64,
}

/// Deterministic replay engine
pub struct ReplayEngine {
    event_log: std::sync::Arc<EventLog>,
}

impl ReplayEngine {
    /// Create a new replay engine
    pub fn new(event_log: std::sync::Arc<EventLog>) -> Self {
        Self { event_log }
    }

    /// Replay execution from event log
    pub fn replay(&self, aggregate_id: &str) -> Result<ReplayState> {
        let events = self.event_log.get_aggregate_events(aggregate_id)?;
        let mut state = ReplayState {
            execution_id: aggregate_id.to_string(),
            variables: HashMap::new(),
            log_position: 0,
        };

        for event in events {
            self.process_event(&event, &mut state)?;
            state.log_position += 1;
        }

        Ok(state)
    }

    /// Replay to a specific sequence number
    pub fn replay_to(&self, aggregate_id: &str, target_sequence: u64) -> Result<ReplayState> {
        let events = self.event_log.get_aggregate_events(aggregate_id)?;
        let mut state = ReplayState {
            execution_id: aggregate_id.to_string(),
            variables: HashMap::new(),
            log_position: 0,
        };

        for event in events.iter().take_while(|e| e.timestamp <= target_sequence) {
            self.process_event(event, &mut state)?;
            state.log_position += 1;
        }

        Ok(state)
    }

    fn process_event(&self, event: &Event, state: &mut ReplayState) -> Result<()> {
        // Apply event to state
        state.variables.insert(
            format!("event:{}", event.id),
            serde_json::json!({
                "type": event.event_type,
                "timestamp": event.timestamp,
            }),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_store::{Event, EventData, EventMetadata, EventLog};
    use rocksdb::DB;
    use std::sync::Arc;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn setup() -> (ReplayEngine, Arc<EventLog>, TempDir) {
        let tmp = TempDir::new().unwrap();
        let storage = Arc::new(crate::event_store::storage::Storage::open(tmp.path()).unwrap());
        let log = Arc::new(EventLog::new(storage, b"test".to_vec()));
        let engine = ReplayEngine::new(log.clone());
        (engine, log, tmp)
    }

    #[test]
    fn test_replay_single_event() {
        let (engine, log, _tmp) = setup();
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

        log.append(event).unwrap();
        let state = engine.replay("exec:1").unwrap();
        assert_eq!(state.execution_id, "exec:1");
        assert_eq!(state.log_position, 1);
    }

    #[test]
    fn test_replay_to_sequence() {
        let (engine, log, _tmp) = setup();
        let metadata = EventMetadata {
            user_id: "user:1".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        for i in 1..=5 {
            let event = Event::new(
                "exec:1".to_string(),
                "TaskScheduled".to_string(),
                EventData::TaskScheduled {
                    task_id: format!("task:{}", i),
                    agent_type: "coder".to_string(),
                    scheduled_time: 1000 + i as u64,
                },
                metadata.clone(),
            );
            log.append(event).unwrap();
        }

        let state = engine.replay_to("exec:1", 3).unwrap();
        assert_eq!(state.log_position, 3);
    }
}
