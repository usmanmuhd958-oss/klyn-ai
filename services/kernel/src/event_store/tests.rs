//! Integration tests for event store

#[cfg(test)]
mod tests {
    use crate::event_store::{Event, EventData, EventMetadata, EventLog};
    use rocksdb::DB;
    use std::sync::Arc;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn setup() -> (EventLog, TempDir) {
        let tmp = TempDir::new().unwrap();
        let mut opts = rocksdb::Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        let db = DB::open_cf(&opts, tmp.path(), vec!["event_log", "index"]).unwrap();
        let storage = Arc::new(super::super::storage::Storage::open(tmp.path()).unwrap());
        let log = EventLog::new(storage, b"test".to_vec());
        (log, tmp)
    }

    #[test]
    fn test_multiple_aggregates() {
        let (log, _tmp) = setup();
        let metadata = EventMetadata {
            user_id: "user:1".to_string(),
            correlation_id: Uuid::new_v4().to_string(),
            parent_event_id: None,
            region: "us-east-1".to_string(),
            created_at: 1000,
        };

        // Append events for different aggregates
        let event1 = Event::new(
            "exec:1".to_string(),
            "IntentSubmitted".to_string(),
            EventData::IntentSubmitted {
                intent_text: "test1".to_string(),
                user_id: "user:1".to_string(),
            },
            metadata.clone(),
        );

        let event2 = Event::new(
            "exec:2".to_string(),
            "IntentSubmitted".to_string(),
            EventData::IntentSubmitted {
                intent_text: "test2".to_string(),
                user_id: "user:1".to_string(),
            },
            metadata.clone(),
        );

        log.append(event1).unwrap();
        log.append(event2).unwrap();

        let agg1_events = log.get_aggregate_events("exec:1").unwrap();
        let agg2_events = log.get_aggregate_events("exec:2").unwrap();

        assert_eq!(agg1_events.len(), 1);
        assert_eq!(agg2_events.len(), 1);
    }
}
