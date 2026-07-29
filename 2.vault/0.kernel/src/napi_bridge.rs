use napi::bindgen_prelude::*;
use napi_derive::napi;
use crate::kernel::KernelState;

#[napi]
pub fn kernel_init() -> Result<i32> {
    let kernel = KernelState::instance();
    Ok(kernel.init())
}

#[napi]
pub fn process_event(buffer: Buffer) -> Result<i32> {
    let kernel = KernelState::instance();
    let ptr = buffer.as_ptr();
    let len = buffer.len();
    Ok(kernel.process_event_fast(ptr, len))
}

#[napi]
pub fn benchmark_kernel() -> Result<u64> {
    let kernel = KernelState::instance();
    Ok(kernel.benchmark())
}

#[napi]
pub struct KernelHandle {
    _private: u8,
}

#[napi]
impl KernelHandle {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let kernel = KernelState::instance();
        kernel.init();
        Ok(Self { _private: 0 })
    }

    #[napi]
    pub fn process(&self, buffer: Buffer) -> Result<i32> {
        process_event(buffer)
    }

    #[napi]
    pub fn cycle_count(&self) -> Result<u64> {
        let kernel = KernelState::instance();
        Ok(kernel.cycle.load(core::sync::atomic::Ordering::Relaxed))
    }
}
