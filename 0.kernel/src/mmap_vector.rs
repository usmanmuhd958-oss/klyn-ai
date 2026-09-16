//! =============================================================================
//! KLYN AI OS — 0.kernel (Rust Heart) — Genesis V670 mmap vector engine
//! File: 0.kernel/src/mmap_vector.rs
//!
//! A memory-mapped `f64` vector engine. Vectors live on disk-backed pages, so
//! large embeddings can be shared between processes (the V670 heart and the
//! brain layer) without copying, and survive process restarts.
//!
//! Layout: little-endian IEEE-754 f64, one per 8-byte slot.
//! =============================================================================

use memmap2::MmapMut;
use std::fs::File;
use std::io;
use std::path::Path;

pub struct MmapVector {
    map: MmapMut,
    len: usize,
}

impl MmapVector {
    /// Create (or truncate) a vector file at `path` with `len` elements.
    pub fn create(path: &Path, len: usize) -> io::Result<Self> {
        let file = File::create(path)?;
        file.set_len((len * std::mem::size_of::<f64>()) as u64)?;
        // SAFETY: the file is exclusively owned by this map; no other mutable
        // references exist at map time.
        let mut map = unsafe { MmapMut::map_mut(&file)? };
        map.fill(0);
        Ok(Self { map, len })
    }

    /// Open an existing vector file, inferring its length from the file size.
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        // SAFETY: the file is exclusively owned by this map at open time.
        let map = unsafe { MmapMut::map_mut(&file)? };
        let len = map.len() / std::mem::size_of::<f64>();
        Ok(Self { map, len })
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Write `value` at index `idx`.
    pub fn set(&mut self, idx: usize, value: f64) {
        assert!(idx < self.len, "mmap vector index out of bounds");
        let start = idx * std::mem::size_of::<f64>();
        self.map[start..start + 8].copy_from_slice(&value.to_le_bytes());
    }

    /// Read the value at index `idx`.
    pub fn get(&self, idx: usize) -> f64 {
        assert!(idx < self.len, "mmap vector index out of bounds");
        let start = idx * std::mem::size_of::<f64>();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&self.map[start..start + 8]);
        f64::from_le_bytes(bytes)
    }

    /// Dot product with another vector (truncated to the shorter length).
    pub fn dot(&self, other: &MmapVector) -> f64 {
        let n = self.len.min(other.len);
        let mut sum = 0.0;
        for i in 0..n {
            sum += self.get(i) * other.get(i);
        }
        sum
    }

    /// Euclidean norm of this vector.
    pub fn norm(&self) -> f64 {
        let n = self.len;
        let mut sum = 0.0;
        for i in 0..n {
            let v = self.get(i);
            sum += v * v;
        }
        sum.sqrt()
    }

    /// Cosine similarity with another vector.
    pub fn cosine_similarity(&self, other: &MmapVector) -> f64 {
        let a = self.norm();
        let b = other.norm();
        if a == 0.0 || b == 0.0 {
            return 0.0;
        }
        self.dot(other) / (a * b)
    }

    /// Persist dirty pages to disk.
    pub fn flush(&self) -> io::Result<()> {
        self.map.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn create_set_get_roundtrip() {
        let dir = std::env::temp_dir();
        let name = format!(
            "v670_mmap_test_{:?}.bin",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        let path = dir.join(name);

        let mut v = MmapVector::create(&path, 4).unwrap();
        v.set(0, 1.5);
        v.set(1, -2.25);
        v.set(2, 3.0);
        v.set(3, 0.125);
        assert_eq!(v.get(0), 1.5);
        assert_eq!(v.get(1), -2.25);
        v.flush().unwrap();

        // Re-open and verify persistence.
        let v2 = MmapVector::open(&path).unwrap();
        assert_eq!(v2.len(), 4);
        assert_eq!(v2.get(2), 3.0);
        assert_eq!(v2.get(3), 0.125);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn cosine_similarity_parallel_vectors() {
        let dir = std::env::temp_dir();
        let name = format!(
            "v670_mmap_cos_{:?}.bin",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        let path = dir.join(name);

        let mut a = MmapVector::create(&path, 3).unwrap();
        a.set(0, 1.0);
        a.set(1, 2.0);
        a.set(2, 3.0);

        let path2 = dir.join(format!("{name}_b"));
        let mut b = MmapVector::create(&path2, 3).unwrap();
        b.set(0, 2.0);
        b.set(1, 4.0);
        b.set(2, 6.0);

        // Parallel vectors → similarity ≈ 1.0.
        let sim = a.cosine_similarity(&b);
        assert!((sim - 1.0).abs() < 1e-9);

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&path2);
    }
}
