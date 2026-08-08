#![deny(clippy::all)]

mod event;
mod kernel;
mod law_vm;
mod memory;
mod ringbuf;
mod mmap_matrix;
mod mmap_vector;
mod simd;
mod telemetry;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use crate::kernel::KernelState;
use std::path::Path;
use std::sync::Mutex;

#[napi]
pub fn kernel_init() -> i32 {
    let kernel = KernelState::instance();
    kernel.init()
}

#[napi]
pub fn process_event(buffer: Buffer) -> i32 {
    let kernel = KernelState::instance();
    let slice: &[u8] = buffer.as_ref();
    if slice.is_empty() {
        return -1;
    }
    kernel.process_event_fast(slice.as_ptr(), slice.len())
}

#[napi]
pub fn benchmark_kernel() -> u32 {
    let kernel = KernelState::instance();
    kernel.benchmark() as u32
}

#[napi]
pub struct KernelHandle {
    _dummy: u8,
}

#[napi]
impl KernelHandle {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { _dummy: 0 }
    }

    #[napi]
    pub fn cycle_count(&self) -> u32 {
        let kernel = KernelState::instance();
        kernel.cycle.load(core::sync::atomic::Ordering::Relaxed) as u32
    }
}
mod llm;

pub mod agent;
pub use agent::{
    start_daemon,
    stop_daemon,
    get_daemon_status,
    force_proactive_scan,
    get_tick_count,
};

// =============================================================================
// PHASE 4 — native SIMD / mmap / lock-free ring exports
// =============================================================================

/// SIMD dot products of a query against a row-major f32 matrix (rows * dims).
#[napi]
pub fn dot_batch(query: Float32Array, matrix: Float32Array, dims: u32) -> Vec<f32> {
    crate::simd::dot_batch_f32(query.as_ref(), matrix.as_ref(), dims as usize)
}

/// Memory-mapped f32 matrix (rows x dims). Rows live on file-backed pages that
/// are shareable with other processes; reads/writes are page-cache transport.
#[napi]
pub struct MmapMatrix {
    inner: Mutex<crate::mmap_matrix::MmapMatrix>,
}

#[napi]
impl MmapMatrix {
    #[napi(constructor)]
    pub fn new(rows: u32, dims: u32) -> Self {
        let path = std::env::temp_dir().join(format!(
            "klyn_mmap_{}_{}_{}.bin",
            std::process::id(),
            rows,
            dims
        ));
        let m = crate::mmap_matrix::MmapMatrix::create(&path, rows as usize, dims as usize)
            .expect("failed to create mmap matrix");
        Self {
            inner: Mutex::new(m),
        }
    }

    /// Create a matrix at an explicit path (shared across processes).
    #[napi]
    pub fn create_mmap(path: String, rows: u32, dims: u32) -> Result<Self> {
        let m = crate::mmap_matrix::MmapMatrix::create(Path::new(&path), rows as usize, dims as usize)
            .map_err(|e| napi::Error::from_reason(format!("create_mmap: {e}")))?;
        Ok(Self {
            inner: Mutex::new(m),
        })
    }

    /// Open an existing matrix file at `path`; rows inferred from file size.
    #[napi]
    pub fn open_mmap(path: String, dims: u32) -> Result<Self> {
        let m = crate::mmap_matrix::MmapMatrix::open(Path::new(&path), dims as usize)
            .map_err(|e| napi::Error::from_reason(format!("open_mmap: {e}")))?;
        Ok(Self {
            inner: Mutex::new(m),
        })
    }

    /// Write one row into the mapped pages.
    #[napi]
    pub fn upsert(&self, row: u32, vector: Float32Array) {
        self.inner.lock().unwrap().upsert(row as usize, vector.as_ref());
    }

    /// Copy one row out of the mapped pages.
    #[napi]
    pub fn row(&self, row: u32) -> Vec<f32> {
        self.inner.lock().unwrap().row(row as usize)
    }

    /// SIMD dot product of a query against every mapped row.
    #[napi]
    pub fn dot_batch(&self, query: Float32Array) -> Vec<f32> {
        self.inner.lock().unwrap().dot_batch(query.as_ref())
    }

    #[napi]
    pub fn rows(&self) -> u32 {
        self.inner.lock().unwrap().rows() as u32
    }

    #[napi]
    pub fn dims(&self) -> u32 {
        self.inner.lock().unwrap().dims() as u32
    }

    /// Persist dirty pages to disk.
    #[napi]
    pub fn flush(&self) -> Result<()> {
        self.inner
            .lock()
            .unwrap()
            .flush()
            .map_err(|e| napi::Error::from_reason(format!("flush: {e}")))
    }
}

/// SIMD engine: f32 dot products with NEON acceleration on aarch64.
#[napi]
pub struct SimdEngine {
    _dummy: u8,
}

#[napi]
impl SimdEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { _dummy: 0 }
    }

    /// Dot product of two equal-length f32 slices.
    #[napi]
    pub fn dot(&self, a: Float32Array, b: Float32Array) -> f32 {
        crate::simd::dot_f32(a.as_ref(), b.as_ref())
    }

    /// Batch dot products: query (dims) x matrix (rows * dims) -> row scores.
    #[napi]
    pub fn dot_batch(&self, query: Float32Array, matrix: Float32Array, dims: u32) -> Vec<f32> {
        crate::simd::dot_batch_f32(query.as_ref(), matrix.as_ref(), dims as usize)
    }
}

/// Lock-free single-producer / single-consumer ring buffer (f64 payloads).
#[napi]
pub struct RingBuffer {
    inner: crate::ringbuf::RingBuffer<f64>,
}

#[napi]
impl RingBuffer {
    #[napi(constructor)]
    pub fn new(capacity: u32, overwrite: bool) -> Self {
        Self {
            inner: crate::ringbuf::RingBuffer::new(capacity as usize, overwrite),
        }
    }

    #[napi]
    pub fn push(&self, value: f64) -> bool {
        self.inner.push(value)
    }

    #[napi]
    pub fn pop(&self) -> Option<f64> {
        self.inner.pop()
    }

    #[napi]
    pub fn len(&self) -> u32 {
        self.inner.len() as u32
    }

    #[napi]
    pub fn capacity(&self) -> u32 {
        self.inner.capacity() as u32
    }

    #[napi]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    #[napi]
    pub fn dropped(&self) -> u32 {
        self.inner.dropped() as u32
    }

    #[napi]
    pub fn overwritten(&self) -> u32 {
        self.inner.overwritten() as u32
    }
}
