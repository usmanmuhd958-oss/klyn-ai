#![allow(static_mut_refs)]

use core::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use crate::memory::RingBuffer;
use crate::law_vm::LawVM;
use crate::event::Event;
use crate::simd::VectorIndex;

const RING_SIZE: usize = 4096;

#[repr(C, align(64))]
pub struct KernelState {
    pub cycle: AtomicU64,
    pub initialized: AtomicBool,
    pub event_ring: RingBuffer<Event, RING_SIZE>,
    pub law_vm: LawVM,
    pub vector_index: VectorIndex,
}

static mut KERNEL: *mut KernelState = core::ptr::null_mut();

impl KernelState {
    #[inline(always)]
    pub fn instance() -> &'static mut Self {
        unsafe {
            if KERNEL.is_null() {
                let boxed = Box::new(KernelState {
                    cycle: AtomicU64::new(0),
                    initialized: AtomicBool::new(false),
                    event_ring: RingBuffer::new(),
                    law_vm: LawVM::new(),
                    vector_index: VectorIndex::new(),
                });
                KERNEL = Box::into_raw(boxed);
            }
            &mut *KERNEL
        }
    }

    #[inline(always)]
    pub fn init(&mut self) -> i32 {
        if self.initialized.load(Ordering::Acquire) {
            return 1;
        }
        
        self.cycle.store(0, Ordering::Release);
        self.law_vm.reset();
        self.vector_index.init();
        self.initialized.store(true, Ordering::Release);
        0
    }

    #[inline(always)]
    pub fn process_event_fast(&mut self, event_ptr: *const u8, len: usize) -> i32 {
        if event_ptr.is_null() || len == 0 {
            return -1;
        }

        let cycle = self.cycle.fetch_add(1, Ordering::Relaxed);
        
        let event = unsafe {
            Event::from_raw(event_ptr, len)
        };

        if !self.law_vm.validate_event(&event, cycle) {
            return -1;
        }

        if !self.event_ring.push(event) {
            return -2;
        }

        self.execute_event(&event)
    }

    #[inline(always)]
    fn execute_event(&mut self, event: &Event) -> i32 {
        match event.opcode() {
            0x01 => self.handle_syscall(event),
            0x02 => self.handle_ast_op(event),
            0x03 => self.handle_vector_query(event),
            _ => -3,
        }
    }

    #[inline(always)]
    fn handle_syscall(&mut self, event: &Event) -> i32 {
        if event.payload().len() < 8 {
            return -4;
        }
        0
    }

    #[inline(always)]
    fn handle_ast_op(&mut self, event: &Event) -> i32 {
        if !self.law_vm.validate_ast_mutation(event.payload()) {
            return -5;
        }
        0
    }

    #[inline(always)]
    fn handle_vector_query(&mut self, event: &Event) -> i32 {
        let payload = event.payload();
        if payload.len() < 512 {
            return -6;
        }
        
        let mut query_vec = [0.0f32; 128];
        for i in 0..128 {
            let offset = i * 4;
            if offset + 4 <= payload.len() {
                let bytes: [u8; 4] = payload[offset..offset + 4].try_into().unwrap_or([0; 4]);
                query_vec[i] = f32::from_le_bytes(bytes);
            }
        }
        
        self.vector_index.search(&query_vec);
        0
    }

    #[inline(always)]
    pub fn benchmark(&mut self) -> u64 {
        let start = self.cycle.load(Ordering::Relaxed);
        let event = Event::synthetic();
        for _ in 0..10000 {
            self.law_vm.validate_event(&event, start);
        }
        self.cycle.load(Ordering::Relaxed) - start
    }
}
