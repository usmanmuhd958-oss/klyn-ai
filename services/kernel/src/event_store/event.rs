//! Event data structures

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Core event representation
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    /// Unique event ID
    pub id: String,
    /// Logical timestamp (Lamport clock)
    pub timestamp: u64,
    /// Aggregate ID (execution context)
    pub aggregate_id: String,
    /// Event type discriminator
    pub event_type: String,
    /// Event payload
    pub data: EventData,
    /// Metadata
    pub metadata: EventMetadata,
    /// HMAC signature for integrity
    pub signature: Vec<u8>,
}

/// Event data payload (flexible)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum EventData {
    IntentSubmitted {
        intent_text: String,
        user_id: String,
    },
    TaskScheduled {
        task_id: String,
        agent_type: String,
        scheduled_time: u64,
    },
    CodeGenerated {
        code: String,
        hash: String,
    },
    ExecutionCompleted {
        result: String,
        duration_ms: u64,
    },
    StateTransition {
        from_state: String,
        to_state: String,
    },
    Custom {
        payload: HashMap<String, serde_json::Value>,
    },
}

/// Event metadata
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EventMetadata {
    /// User who triggered the event
    pub user_id: String,
    /// Correlation ID for tracing
    pub correlation_id: String,
    /// Parent event ID (causal ordering)
    pub parent_event_id: Option<String>,
    /// Region where event occurred
    pub region: String,
    /// Creation timestamp (wall clock)
    pub created_at: i64,
}

impl Event {
    /// Create a new event
    pub fn new(
        aggregate_id: String,
        event_type: String,
        data: EventData,
        metadata: EventMetadata,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            timestamp: 0, // Will be assigned by log
            aggregate_id,
            event_type,
            data,
            metadata,
            signature: Vec::new(),
        }
    }

    /// Sign the event with HMAC
    pub fn sign(&mut self, secret: &[u8]) -> crate::Result<()> {
        use sha2::{Digest, Sha256};

        let payload = format!(
            "{}:{}:{}:{}",
            self.id, self.timestamp, self.aggregate_id, self.event_type
        );

        let mut mac = Sha256::new();
        mac.update(payload.as_bytes());
        mac.update(secret);

        self.signature = mac.finalize().to_vec();
        Ok(())
    }

    /// Verify the event signature
    pub fn verify_signature(&self, secret: &[u8]) -> crate::Result<bool> {
        use sha2::{Digest, Sha256};

        let payload = format!(
            "{}:{}:{}:{}",
            self.id, self.timestamp, self.aggregate_id, self.event_type
        );

        let mut mac = Sha256::new();
        mac.update(payload.as_bytes());
        mac.update(secret);

        Ok(mac.finalize().to_vec() == self.signature)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_creation() {
        let metadata = EventMetadata {
            user_id: "user:123".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        let event = Event::new(
            "execution:456".to_string(),
            "IntentSubmitted".to_string(),
            EventData::IntentSubmitted {
                intent_text: "Build Flask app".to_string(),
                user_id: "user:123".to_string(),
            },
            metadata,
        );

        assert_eq!(event.aggregate_id, "execution:456");
        assert_eq!(event.event_type, "IntentSubmitted");
    }

    #[test]
    fn test_event_signature() {
        let secret = b"my-secret-key";
        let metadata = EventMetadata {
            user_id: "user:123".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        let mut event = Event::new(
            "execution:456".to_string(),
            "IntentSubmitted".to_string(),
            EventData::IntentSubmitted {
                intent_text: "Build Flask app".to_string(),
                user_id: "user:123".to_string(),
            },
            metadata,
        );

        event.sign(secret).unwrap();
        assert!(event.verify_signature(secret).unwrap());
        assert!(!event.verify_signature(b"wrong-key").unwrap());
    }
}
