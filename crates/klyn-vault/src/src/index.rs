#![allow(dead_code)]
use ahash::AHashMap;
use crate::simd::EMBEDDING_DIMS;

pub struct IndexEntry {
    pub law_vm_hash: u64,
    pub embedding: [f32; EMBEDDING_DIMS],
    pub tags: Vec<String>,
}

pub struct MemoryIndex {
    entries: AHashMap<String, IndexEntry>,
    tag_index: AHashMap<String, Vec<String>>,
}

impl MemoryIndex {
    pub fn new() -> Self {
        Self {
            entries: AHashMap::new(),
            tag_index: AHashMap::new(),
        }
    }

    pub fn insert(&mut self, id: String, law_vm_hash: u64, embedding: &[f32], tags: &[String]) {
        let embedding_array: [f32; EMBEDDING_DIMS] = embedding
            .try_into()
            .unwrap_or([0.0; EMBEDDING_DIMS]);

        let entry = IndexEntry {
            law_vm_hash,
            embedding: embedding_array,
            tags: tags.to_vec(),
        };

        for tag in tags {
            self.tag_index
                .entry(tag.clone())
                .or_insert_with(Vec::new)
                .push(id.clone());
        }

        self.entries.insert(id, entry);
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &IndexEntry)> {
        self.entries.iter()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}
