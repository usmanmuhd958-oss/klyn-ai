#![deny(clippy::all)]

mod event;
mod kernel;
mod law_vm;
mod memory;
mod simd;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use crate::kernel::KernelState;

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
