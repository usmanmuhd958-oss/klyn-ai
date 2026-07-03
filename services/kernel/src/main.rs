//! KLYN Kernel - Main entry point

use klyn_kernel::event_store::{Event, EventData, EventLog, EventMetadata};
use std::sync::Arc;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    // Initialize storage
    let storage = Arc::new(klyn_kernel::event_store::storage::Storage::open("/tmp/klyn-kernel")?);;
    let event_log = Arc::new(EventLog::new(storage, b"secret-key".to_vec()));

    // Create a sample event
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
            intent_text: "Build Flask app".to_string(),
            user_id: "user:1".to_string(),
        },
        metadata,
    );

    // Append event
    let seq = event_log.append(event)?;
    println!("Event appended with sequence: {}", seq);

    // Replay execution
    let replay_engine = klyn_kernel::replay::ReplayEngine::new(event_log.clone());
    let state = replay_engine.replay("exec:1")?;
    println!("Replayed state: {:?}", state);

    Ok(())
}
