#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

const VECTOR_DIM: usize = 128;
const INDEX_SIZE: usize = 1024;

#[repr(C, align(64))]
pub struct VectorIndex {
    vectors: [[f32; VECTOR_DIM]; INDEX_SIZE],
    count: usize,
}

impl VectorIndex {
    #[inline(always)]
    pub const fn new() -> Self {
        Self {
            vectors: [[0.0f32; VECTOR_DIM]; INDEX_SIZE],
            count: 0,
        }
    }

    #[inline(always)]
    pub fn init(&mut self) {
        self.count = 0;
        for i in 0..INDEX_SIZE {
            for j in 0..VECTOR_DIM {
                self.vectors[i][j] = (i ^ j) as f32 * 0.001;
            }
        }
        self.count = INDEX_SIZE;
    }

    #[inline(always)]
    pub fn search(&self, query: &[f32]) -> (usize, f32) {
        let mut best_idx = 0;
        let mut best_score = f32::NEG_INFINITY;

        for i in 0..self.count {
            let score = self.dot_product(&self.vectors[i], query);
            if score > best_score {
                best_score = score;
                best_idx = i;
            }
        }

        (best_idx, best_score)
    }

    #[inline(always)]
    fn dot_product(&self, a: &[f32], b: &[f32]) -> f32 {
        #[cfg(target_arch = "aarch64")]
        unsafe {
            let mut sum = vdupq_n_f32(0.0);
            for i in (0..VECTOR_DIM).step_by(4) {
                let va = vld1q_f32(a.as_ptr().add(i));
                let vb = vld1q_f32(b.as_ptr().add(i));
                sum = vfmaq_f32(sum, va, vb);
            }
            let mut result = [0.0f32; 4];
            vst1q_f32(result.as_mut_ptr(), sum);
            result[0] + result[1] + result[2] + result[3]
        }
        #[cfg(not(target_arch = "aarch64"))]
        {
            a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
        }
    }
}

/// Dot product of two f32 slices, NEON-accelerated on aarch64.
#[inline(always)]
pub fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    #[cfg(target_arch = "aarch64")]
    unsafe {
        let mut acc = vdupq_n_f32(0.0f32);
        let mut i = 0;
        while i + 4 <= n {
            let va = vld1q_f32(a.as_ptr().add(i));
            let vb = vld1q_f32(b.as_ptr().add(i));
            acc = vfmaq_f32(acc, va, vb);
            i += 4;
        }
        let mut s = vaddvq_f32(acc);
        while i < n {
            s += a[i] * b[i];
            i += 1;
        }
        s
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        a.iter().zip(b.iter()).take(n).map(|(x, y)| x * y).sum()
    }
}

/// Batch dot products: `query` (dims) against a row-major matrix (rows * dims).
pub fn dot_batch_f32(query: &[f32], matrix: &[f32], dims: usize) -> Vec<f32> {
    if dims == 0 || matrix.len() < dims {
        return Vec::new();
    }
    let rows = matrix.len() / dims;
    let mut out = Vec::with_capacity(rows);
    for r in 0..rows {
        out.push(dot_f32(&matrix[r * dims..(r + 1) * dims], query));
    }
    out
}
