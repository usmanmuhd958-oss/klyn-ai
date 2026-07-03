//! Scheduler interfaces and task queue

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use parking_lot::Mutex;
use std::sync::Arc;
use crate::Result;

/// Task to be scheduled
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub agent_type: String,
    pub priority: u8,
    pub created_at: u64,
}

/// Scheduler trait
#[async_trait]
pub trait Scheduler: Send + Sync {
    /// Schedule a task
    async fn schedule(&self, task: Task) -> Result<String>;
    /// Get next task to execute
    async fn next_task(&self) -> Result<Option<Task>>;
    /// Mark task as complete
    async fn complete(&self, task_id: &str) -> Result<()>;
}

/// FIFO scheduler
pub struct FifoScheduler {
    queue: Arc<Mutex<VecDeque<Task>>>,
}

impl FifoScheduler {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }
}

#[async_trait]
impl Scheduler for FifoScheduler {
    async fn schedule(&self, task: Task) -> Result<String> {
        let task_id = task.id.clone();
        self.queue.lock().push_back(task);
        Ok(task_id)
    }

    async fn next_task(&self) -> Result<Option<Task>> {
        Ok(self.queue.lock().pop_front())
    }

    async fn complete(&self, _task_id: &str) -> Result<()> {
        Ok(())
    }
}

/// Priority scheduler (higher priority first)
pub struct PriorityScheduler {
    queue: Arc<Mutex<Vec<Task>>>,
}

impl PriorityScheduler {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait]
impl Scheduler for PriorityScheduler {
    async fn schedule(&self, task: Task) -> Result<String> {
        let task_id = task.id.clone();
        let mut queue = self.queue.lock();
        let pos = queue.iter().position(|t| t.priority < task.priority).unwrap_or(queue.len());
        queue.insert(pos, task);
        Ok(task_id)
    }

    async fn next_task(&self) -> Result<Option<Task>> {
        let mut queue = self.queue.lock();
        if queue.is_empty() {
            Ok(None)
        } else {
            Ok(Some(queue.remove(0)))
        }
    }

    async fn complete(&self, _task_id: &str) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fifo_scheduler() {
        let scheduler = FifoScheduler::new();
        let task = Task {
            id: "task:1".to_string(),
            agent_type: "coder".to_string(),
            priority: 1,
            created_at: 1000,
        };

        let task_id = scheduler.schedule(task.clone()).await.unwrap();
        assert_eq!(task_id, "task:1");

        let next = scheduler.next_task().await.unwrap();
        assert!(next.is_some());
        assert_eq!(next.unwrap().id, "task:1");
    }

    #[tokio::test]
    async fn test_priority_scheduler() {
        let scheduler = PriorityScheduler::new();

        let task1 = Task {
            id: "task:1".to_string(),
            agent_type: "coder".to_string(),
            priority: 1,
            created_at: 1000,
        };

        let task2 = Task {
            id: "task:2".to_string(),
            agent_type: "executor".to_string(),
            priority: 10,
            created_at: 1001,
        };

        scheduler.schedule(task1).await.unwrap();
        scheduler.schedule(task2).await.unwrap();

        // Higher priority (10) should be executed first
        let first = scheduler.next_task().await.unwrap().unwrap();
        assert_eq!(first.id, "task:2");
    }
}
