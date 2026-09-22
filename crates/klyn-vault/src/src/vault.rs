use crate::index::MemoryIndex;
use crate::simd::{simd_cosine_similarity, EMBEDDING_DIMS};
use crate::storage::{MemoryStorage, StoredMemory};
use parking_lot::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct RecallResult {
    pub id: String,
    pub score: f64,
    pub timestamp: i64,
    pub payload: Vec<u8>,
    pub tags: Vec<String>,
}

pub struct Vault {
    storage: RwLock<Option<MemoryStorage>>,
    index: RwLock<MemoryIndex>,
    recall_count: AtomicU64,
}

impl Vault {
    pub fn new() -> Self {
        Self {
            storage: RwLock::new(None),
            index: RwLock::new(MemoryIndex::new()),
            recall_count: AtomicU64::new(0),
        }
    }

    pub fn initialize(&self, path: String) -> Result<(), String> {
        let mut storage_lock = self.storage.write();
        if storage_lock.is_some() {
            return Ok(());
        }

        let storage = MemoryStorage::open(path)
            .map_err(|e| format!("Failed to open storage: {}", e))?;

        let mut index = self.index.write();
        for memory in storage.iter_memories() {
            index.insert(
                memory.id.clone(),
                memory.law_vm_hash,
                &memory.embedding,
                &memory.tags,
            );
        }

        *storage_lock = Some(storage);
        Ok(())
    }

    pub fn store_memory(
        &self,
        id: String,
        law_vm_hash: String,
        embedding: Vec<f32>,
        payload: Vec<u8>,
        tags: Vec<String>,
    ) -> Result<String, String> {
        if embedding.len() != EMBEDDING_DIMS {
            return Err(format!("Invalid embedding length: expected {}, got {}", EMBEDDING_DIMS, embedding.len()));
        }

        let law_vm_hash_u64 = Self::hash_string(&law_vm_hash);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        let storage_lock = self.storage.read();
        let storage = storage_lock
            .as_ref()
            .ok_or_else(|| "Vault not initialized".to_string())?;

        let memory = StoredMemory {
            id: id.clone(),
            timestamp,
            law_vm_hash: law_vm_hash_u64,
            embedding: embedding.clone(),
            payload,
            tags: tags.clone(),
        };

        storage
            .append_memory(&memory)
            .map_err(|e| format!("Failed to append memory: {}", e))?;

        let mut index = self.index.write();
        index.insert(id.clone(), law_vm_hash_u64, &memory.embedding, &tags);

        Ok(id)
    }

    pub fn recall(
        &self,
        query_embedding: Vec<f32>,
        law_vm_hash: String,
        top_k: usize,
        threshold: f64,
    ) -> Result<Vec<RecallResult>, String> {
        if query_embedding.len() != EMBEDDING_DIMS {
            return Err(format!("Invalid query dimension: expected {}, got {}", EMBEDDING_DIMS, query_embedding.len()));
        }

        let law_vm_hash_u64 = Self::hash_string(&law_vm_hash);
        let query_vec: [f32; EMBEDDING_DIMS] = query_embedding.try_into().unwrap_or([0.0; EMBEDDING_DIMS]);

        let index = self.index.read();
        let storage_lock = self.storage.read();
        let storage = storage_lock
            .as_ref()
            .ok_or_else(|| "Vault not initialized".to_string())?;

        let mut candidates: Vec<(String, f32)> = Vec::with_capacity(index.len());

        for (memory_id, entry) in index.iter() {
            if entry.law_vm_hash != law_vm_hash_u64 {
                continue;
            }

            let score = unsafe { simd_cosine_similarity(&query_vec, &entry.embedding) };
            if score >= threshold as f32 {
                candidates.push((memory_id.clone(), score));
            }
        }

        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let k = top_k.min(candidates.len());
        let mut results = Vec::with_capacity(k);

        for (memory_id, score) in candidates.into_iter().take(k) {
            if let Some(memory) = storage.iter_memories().into_iter().find(|m| m.id == memory_id) {
                results.push(RecallResult {
                    id: memory.id,
                    score: score as f64,
                    timestamp: memory.timestamp,
                    payload: memory.payload,
                    tags: memory.tags,
                });
            }
        }

        self.recall_count.fetch_add(1, Ordering::Relaxed);
        Ok(results)
    }

    fn hash_string(s: &str) -> u64 {
        let mut hash: u64 = 5381;
        for byte in s.bytes() {
            hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
        }
        hash
    }
}
