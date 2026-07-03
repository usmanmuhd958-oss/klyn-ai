//! Raft consensus abstraction

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use crate::Result;

/// Raft node state
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum NodeState {
    Follower,
    Candidate,
    Leader,
}

/// Log entry
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub term: u64,
    pub index: u64,
    pub data: Vec<u8>,
}

/// Raft node
pub struct RaftNode {
    id: String,
    state: Arc<RwLock<NodeState>>,
    current_term: Arc<RwLock<u64>>,
    voted_for: Arc<RwLock<Option<String>>>,
    log: Arc<RwLock<Vec<LogEntry>>>,
    commit_index: Arc<RwLock<u64>>,
    last_applied: Arc<RwLock<u64>>,
}

impl RaftNode {
    pub fn new(id: String) -> Self {
        Self {
            id,
            state: Arc::new(RwLock::new(NodeState::Follower)),
            current_term: Arc::new(RwLock::new(0)),
            voted_for: Arc::new(RwLock::new(None)),
            log: Arc::new(RwLock::new(Vec::new())),
            commit_index: Arc::new(RwLock::new(0)),
            last_applied: Arc::new(RwLock::new(0)),
        }
    }

    /// Get current state
    pub fn state(&self) -> NodeState {
        *self.state.read()
    }

    /// Get current term
    pub fn current_term(&self) -> u64 {
        *self.current_term.read()
    }

    /// Append entry to log
    pub fn append_entry(&self, entry: LogEntry) -> Result<u64> {
        let mut log = self.log.write();
        let index = log.len() as u64;
        log.push(entry);
        Ok(index)
    }

    /// Get log entry
    pub fn get_entry(&self, index: u64) -> Result<Option<LogEntry>> {
        Ok(self.log.read().get(index as usize).cloned())
    }

    /// Get log length
    pub fn log_length(&self) -> Result<u64> {
        Ok(self.log.read().len() as u64)
    }

    /// Vote for a candidate
    pub fn vote_for(&self, candidate_id: &str, term: u64) -> Result<bool> {
        let mut current_term = self.current_term.write();
        let mut voted_for = self.voted_for.write();

        if term < *current_term {
            return Ok(false);
        }

        if term > *current_term {
            *current_term = term;
            *voted_for = Some(candidate_id.to_string());
            return Ok(true);
        }

        match &*voted_for {
            None => {
                *voted_for = Some(candidate_id.to_string());
                Ok(true)
            }
            Some(already_voted) => Ok(already_voted == candidate_id),
        }
    }

    /// Become leader
    pub fn become_leader(&self) -> Result<()> {
        *self.state.write() = NodeState::Leader;
        Ok(())
    }

    /// Become follower
    pub fn become_follower(&self, term: u64) -> Result<()> {
        let mut current_term = self.current_term.write();
        if term > *current_term {
            *current_term = term;
            *self.voted_for.write() = None;
        }
        *self.state.write() = NodeState::Follower;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raft_node_creation() {
        let node = RaftNode::new("node:1".to_string());
        assert_eq!(node.state(), NodeState::Follower);
        assert_eq!(node.current_term(), 0);
    }

    #[test]
    fn test_append_entry() {
        let node = RaftNode::new("node:1".to_string());
        let entry = LogEntry {
            term: 1,
            index: 0,
            data: b"test".to_vec(),
        };

        let index = node.append_entry(entry.clone()).unwrap();
        assert_eq!(index, 0);

        let retrieved = node.get_entry(0).unwrap();
        assert_eq!(retrieved, Some(entry));
    }

    #[test]
    fn test_voting() {
        let node = RaftNode::new("node:1".to_string());

        assert!(node.vote_for("candidate:1", 1).unwrap());
        assert!(!node.vote_for("candidate:2", 1).unwrap());
        assert!(node.vote_for("candidate:1", 1).unwrap());
    }

    #[test]
    fn test_state_transitions() {
        let node = RaftNode::new("node:1".to_string());
        assert_eq!(node.state(), NodeState::Follower);

        node.become_leader().unwrap();
        assert_eq!(node.state(), NodeState::Leader);

        node.become_follower(2).unwrap();
        assert_eq!(node.state(), NodeState::Follower);
    }
}
