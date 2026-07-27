use core::sync::atomic::{AtomicU64, Ordering};
use crate::event::Event;

const VALIDATION_RULES: usize = 256;
const STATE_SLOTS: usize = 1024;

#[repr(C, align(64))]
pub struct LawVM {
    state_hash: AtomicU64,
    rule_table: [u64; VALIDATION_RULES],
    state_slots: [AtomicU64; STATE_SLOTS],
}

impl LawVM {
    #[inline(always)]
    pub fn new() -> Self {
        let mut slots: [AtomicU64; STATE_SLOTS] = unsafe { core::mem::zeroed() };
        for slot in slots.iter_mut() {
            *slot = AtomicU64::new(0);
        }
        Self {
            state_hash: AtomicU64::new(0x5f3759df),
            rule_table: [0u64; VALIDATION_RULES],
            state_slots: slots,
        }
    }

    #[inline(always)]
    pub fn reset(&mut self) {
        self.state_hash.store(0x5f3759df, Ordering::Release);
        for slot in self.state_slots.iter_mut() {
            slot.store(0, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn validate_event(&self, event: &Event, cycle: u64) -> bool {
        let opcode = event.opcode() as usize;
        if opcode >= VALIDATION_RULES {
            return false;
        }

        let rule = self.rule_table[opcode];
        let hash = self.compute_hash(event.payload(), cycle);
        
        let slot_idx = (hash as usize) % STATE_SLOTS;
        let prev_state = self.state_slots[slot_idx].load(Ordering::Acquire);
        
        let valid = (hash ^ prev_state ^ rule) & 0x8000_0000_0000_0000 == 0;
        
        if valid {
            self.state_slots[slot_idx].store(hash, Ordering::Release);
            self.state_hash.fetch_xor(hash, Ordering::AcqRel);
        }
        
        valid
    }

    #[inline(always)]
    pub fn validate_ast_mutation(&self, payload: &[u8]) -> bool {
        if payload.len() < 16 {
            return false;
        }

        let hash = self.compute_hash(payload, 0);
        let current_state = self.state_hash.load(Ordering::Acquire);
        
        (hash ^ current_state).count_ones() <= 32
    }

    #[inline(always)]
    fn compute_hash(&self, data: &[u8], cycle: u64) -> u64 {
        let mut hash = 0xcbf29ce484222325u64;
        hash ^= cycle;
        
        for &byte in data.iter() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        
        hash
    }
}
