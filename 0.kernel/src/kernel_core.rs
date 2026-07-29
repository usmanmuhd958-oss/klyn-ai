//! KLYN AI OS v3.0 - Core Kernel Orchestrator
//!
//! Zero-copy event processing with sub-microsecond latency target.

use crate::bus::Bus;
use crate::law_vm::{LawVm, VmError};
use crate::vault::{Vault, VaultError, SealedData};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};

const MAX_VM_CYCLES: usize = 10000;

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct KernelEvent {
    pub event_id: u64,
    pub timestamp: u64,
    pub event_type: u32,
    pub priority: u8,
    pub flags: u8,
    pub data_offset: u16,
    pub data_len: u32,
}

impl KernelEvent {
    #[inline(always)]
    pub fn new(event_type: u32, data_offset: u16, data_len: u32) -> Self {
        Self {
            event_id: 0,
            timestamp: Self::nanos_since_epoch(),
            event_type,
            priority: 0,
            flags: 0,
            data_offset,
            data_len,
        }
    }

    #[inline(always)]
    fn nanos_since_epoch() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64
    }
}

#[derive(Debug)]
pub enum KernelError {
    BusFull,
    BusEmpty,
    VmError(VmError),
    VaultError(VaultError),
    InvalidEvent,
    ShutdownInProgress,
}

impl From<VmError> for KernelError {
    fn from(err: VmError) -> Self {
        KernelError::VmError(err)
    }
}

impl From<VaultError> for KernelError {
    fn from(err: VaultError) -> Self {
        KernelError::VaultError(err)
    }
}

impl std::fmt::Display for KernelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KernelError::BusFull => write!(f, "Event bus full"),
            KernelError::BusEmpty => write!(f, "Event bus empty"),
            KernelError::VmError(e) => write!(f, "VM error: {}", e),
            KernelError::VaultError(e) => write!(f, "Vault error: {}", e),
            KernelError::InvalidEvent => write!(f, "Invalid event"),
            KernelError::ShutdownInProgress => write!(f, "Kernel shutdown in progress"),
        }
    }
}

impl std::error::Error for KernelError {}

pub struct KernelCore {
    event_bus: Arc<Bus<KernelEvent>>,
    law_vm: LawVm,
    vault: Vault,
    event_counter: AtomicU64,
    processed_count: AtomicU64,
    running: AtomicBool,
}

impl KernelCore {
    pub fn new() -> Result<Self, KernelError> {
        Ok(Self {
            event_bus: Arc::new(Bus::new()),
            law_vm: LawVm::new(),
            vault: Vault::new()?,
            event_counter: AtomicU64::new(0),
            processed_count: AtomicU64::new(0),
            running: AtomicBool::new(true),
        })
    }

    #[inline(always)]
    pub fn submit_event(&self, mut event: KernelEvent) -> Result<(), KernelError> {
        if !self.running.load(Ordering::Acquire) {
            return Err(KernelError::ShutdownInProgress);
        }

        event.event_id = self.event_counter.fetch_add(1, Ordering::Relaxed);
        
        self.event_bus
            .try_send(event)
            .map_err(|_| KernelError::BusFull)
    }

    #[inline(always)]
    pub fn process_event(&mut self) -> Result<bool, KernelError> {
        if !self.running.load(Ordering::Acquire) {
            return Err(KernelError::ShutdownInProgress);
        }

        match self.event_bus.try_recv() {
            Some(event) => {
                self.validate_event(&event)?;
                self.processed_count.fetch_add(1, Ordering::Relaxed);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    #[inline]
    fn validate_event(&mut self, event: &KernelEvent) -> Result<(), KernelError> {
        if event.event_type == 0 {
            return Ok(());
        }

        self.law_vm.reset();
        let result = self.law_vm.execute(MAX_VM_CYCLES)?;
        
        if result == 0 {
            return Err(KernelError::InvalidEvent);
        }

        Ok(())
    }

    #[inline]
    pub fn load_law_program(&mut self, bytecode: &[u8]) -> Result<(), KernelError> {
        self.law_vm.load_program(bytecode)?;
        Ok(())
    }

    #[inline]
    pub fn seal_data(&mut self, data: &[u8]) -> Result<SealedData, KernelError> {
        Ok(self.vault.seal(data)?)
    }

    #[inline]
    pub fn unseal_data(&self, sealed: &SealedData) -> Result<Vec<u8>, KernelError> {
        Ok(self.vault.unseal(sealed)?)
    }

    pub fn get_bus(&self) -> Arc<Bus<KernelEvent>> {
        Arc::clone(&self.event_bus)
    }

    pub fn processed_count(&self) -> u64 {
        self.processed_count.load(Ordering::Acquire)
    }

    pub fn event_count(&self) -> u64 {
        self.event_counter.load(Ordering::Acquire)
    }

    pub fn pending_count(&self) -> usize {
        self.event_bus.len()
    }

    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
    }

    #[inline(always)]
    pub fn process_batch(&mut self, max_events: usize) -> Result<usize, KernelError> {
        let mut processed = 0;
        
        for _ in 0..max_events {
            match self.process_event() {
                Ok(true) => processed += 1,
                Ok(false) => break,
                Err(e) => return Err(e),
            }
        }

        Ok(processed)
    }
}

impl Default for KernelCore {
    fn default() -> Self {
        Self::new().expect("Failed to initialize kernel")
    }
}
