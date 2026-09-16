//! =============================================================================
//! KLYN AI OS — 0.kernel (Rust Heart) — Genesis V670 mmap matrix engine
//! File: 0.kernel/src/mmap_matrix.rs
//!
//! A memory-mapped `f32` row-major matrix (rows x dims). Rows are written
//! directly into file-backed pages, so a matrix can be shared between the
//! Node/TS runtime and other processes without copying — the OS page cache
//! is the transport. `dot_batch` sweeps the mapped pages with the SIMD
//! engine (NEON on aarch64, scalar fallback elsewhere).
//!
//! Layout: little-endian IEEE-754 f32, row-major, rows * dims * 4 bytes.
//! =============================================================================

use crate::simd::dot_f32;
use memmap2::MmapMut;
use std::fs::File;
use std::io;
use std::path::Path;

pub struct MmapMatrix {
    map: MmapMut,
    rows: usize,
    dims: usize,
}

impl MmapMatrix {
    /// Create (or truncate) a matrix file at `path` with `rows * dims` f32s.
    pub fn create(path: &Path, rows: usize, dims: usize) -> io::Result<Self> {
        let file = File::create(path)?;
        file.set_len((rows * dims * std::mem::size_of::<f32>()) as u64)?;
        // SAFETY: the file is exclusively owned by this map; no other mutable
        // references exist at map time.
        let mut map = unsafe { MmapMut::map_mut(&file)? };
        map.fill(0);
        Ok(Self { map, rows, dims })
    }

    /// Open an existing matrix file; rows are inferred from the file size.
    pub fn open(path: &Path, dims: usize) -> io::Result<Self> {
        let file = File::open(path)?;
        // SAFETY: the file is exclusively owned by this map at open time.
        let map = unsafe { MmapMut::map_mut(&file)? };
        let len = map.len() / std::mem::size_of::<f32>();
        if dims == 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "dims must be non-zero"));
        }
        Ok(Self {
            map,
            rows: len / dims,
            dims,
        })
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn dims(&self) -> usize {
        self.dims
    }

    pub fn len(&self) -> usize {
        self.rows * self.dims
    }

    pub fn is_empty(&self) -> bool {
        self.rows == 0
    }

    /// Write one row from `data` (truncated to dims) into the mapped pages.
    pub fn upsert(&mut self, row: usize, data: &[f32]) {
        assert!(row < self.rows, "mmap matrix row out of bounds");
        let start = row * self.dims * std::mem::size_of::<f32>();
        let n = data.len().min(self.dims);
        for i in 0..n {
            let bytes = data[i].to_le_bytes();
            self.map[start + i * 4..start + i * 4 + 4].copy_from_slice(&bytes);
        }
    }

    /// Copy one row out of the mapped pages.
    pub fn row(&self, row: usize) -> Vec<f32> {
        assert!(row < self.rows, "mmap matrix row out of bounds");
        let start = row * self.dims * std::mem::size_of::<f32>();
        let mut out = vec![0.0f32; self.dims];
        for i in 0..self.dims {
            let mut bytes = [0u8; 4];
            bytes.copy_from_slice(&self.map[start + i * 4..start + i * 4 + 4]);
            out[i] = f32::from_le_bytes(bytes);
        }
        out
    }

    /// SIMD dot product of `query` against every mapped row.
    pub fn dot_batch(&self, query: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.rows);
        for r in 0..self.rows {
            let row = self.row(r);
            out.push(dot_f32(&row, query));
        }
        out
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

    fn temp_path(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir();
        let name = format!(
            "v670_mmap_matrix_{tag}_{:?}.bin",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        );
        dir.join(name)
    }

    #[test]
    fn upsert_dot_batch_roundtrip() {
        let path = temp_path("up");
        let mut m = MmapMatrix::create(&path, 3, 4).unwrap();
        assert_eq!(m.rows(), 3);
        assert_eq!(m.dims(), 4);
        m.upsert(0, &[1.0, 2.0, 3.0, 4.0]);
        m.upsert(1, &[4.0, 3.0, 2.0, 1.0]);
        m.upsert(2, &[0.0, 0.0, 1.0, 1.0]);
        m.flush().unwrap();

        let scores = m.dot_batch(&[1.0, 1.0, 1.0, 1.0]);
        assert_eq!(scores.len(), 3);
        assert!((scores[0] - 10.0).abs() < 1e-4);
        assert!((scores[1] - 10.0).abs() < 1e-4);
        assert!((scores[2] - 2.0).abs() < 1e-4);

        let m2 = MmapMatrix::open(&path, 4).unwrap();
        let row0 = m2.row(0);
        assert_eq!(row0, vec![1.0, 2.0, 3.0, 4.0]);

        let _ = std::fs::remove_file(&path);
    }
}
