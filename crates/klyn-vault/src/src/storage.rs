#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use parking_lot::RwLock;
use std::io;
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredMemory {
    pub id: String,
    pub timestamp: i64,
    pub law_vm_hash: u64,
    pub embedding: Vec<f32>,
    pub payload: Vec<u8>,
    pub tags: Vec<String>,
}

pub struct MemoryStorage {
    base_path: PathBuf,
    memories: RwLock<Vec<StoredMemory>>,
}

impl MemoryStorage {
    pub fn open(path: String) -> io::Result<Self> {
        let base_path = PathBuf::from(path);
        std::fs::create_dir_all(&base_path)?;

        Ok(Self {
            base_path,
            memories: RwLock::new(Vec::new()),
        })
    }

    pub fn append_memory(&self, memory: &StoredMemory) -> io::Result<()> {
        let mut memories = self.memories.write();
        memories.push(memory.clone());
        Ok(())
    }

    pub fn iter_memories(&self) -> Vec<StoredMemory> {
        self.memories.read().clone()
    }

    pub fn count(&self) -> usize {
        self.memories.read().len()
    }
}
