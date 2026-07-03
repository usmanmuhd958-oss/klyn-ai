//! Integration tests for the kernel

use klyn_kernel::event_store::{Event, EventData, EventLog, EventMetadata};
use klyn_kernel::replay::ReplayEngine;
use klyn_kernel::capability::CapabilityManager;
use klyn_kernel::ledger::ResourceLedger;
use std::sync::Arc;
use tempfile::TempDir;
use uuid::Uuid;

#[tokio::test]
async fn test_full_workflow() {
    let tmp = TempDir::new().unwrap();
    let storage = Arc::new(
        klyn_kernel::event_store::storage::Storage::open(tmp.path()).unwrap(),
    );
    let event_log = Arc::new(EventLog::new(storage, b"test-secret".to_vec()));

    // Create metadata
    let metadata = EventMetadata {
        user_id: "user:1".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        parent_event_id: None,
        region: "us-east-1".to_string(),
        created_at: 1000,
    };

    // Append multiple events
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
        event_log.append(event).unwrap();
    }

    // Verify event count
    assert_eq!(event_log.current_sequence(), 5);

    // Replay events
    let replay_engine = ReplayEngine::new(event_log.clone());
    let state = replay_engine.replay("exec:1").unwrap();
    assert_eq!(state.log_position, 5);

    // Test capability manager
    let cap_manager = CapabilityManager::new();
    assert!(cap_manager
        .verify("nonexistent", "read", 1000)
        .unwrap()
        .eq(&false));

    // Test ledger
    let ledger = ResourceLedger::new();
    assert_eq!(ledger.count().unwrap(), 0);
}

#[tokio::test]
async fn test_deterministic_replay() {
    let tmp = TempDir::new().unwrap();
    let storage = Arc::new(
        klyn_kernel::event_store::storage::Storage::open(tmp.path()).unwrap(),
    );
    let event_log = Arc::new(EventLog::new(storage, b"test-secret".to_vec()));

    let metadata = EventMetadata {
        user_id: "user:1".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        parent_event_id: None,
        region: "us-east-1".to_string(),
        created_at: 1000,
    };

    // Append events
    for i in 1..=3 {
        let event = Event::new(
            "exec:det".to_string(),
            "StateTransition".to_string(),
            EventData::StateTransition {
                from_state: format!("state:{}", i - 1),
                to_state: format!("state:{}", i),
            },
            metadata.clone(),
        );
        event_log.append(event).unwrap();
    }

    // Replay twice and verify consistency
    let replay_engine = ReplayEngine::new(event_log.clone());
    let state1 = replay_engine.replay("exec:det").unwrap();
    let state2 = replay_engine.replay("exec:det").unwrap();

    assert_eq!(state1.log_position, state2.log_position);
    assert_eq!(state1.variables.len(), state2.variables.len());
}
