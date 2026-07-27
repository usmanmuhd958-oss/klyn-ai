//! Lock-Free MPMC Ring Buffer Event Bus
//!
//! Zero-mutex, wait-free message passing substrate for kernel events.
//! Cache-line aligned to prevent false sharing.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::cell::UnsafeCell;
use std::mem::MaybeUninit;

const CACHE_LINE: usize = 64;
const RING_SIZE: usize = 65536; // Power of 2 for fast modulo

#[repr(C, align(64))]
struct Slot<T> {
    sequence: AtomicU64,
    value: UnsafeCell<MaybeUninit<T>>,
}

unsafe impl<T: Send> Send for Slot<T> {}
unsafe impl<T: Send> Sync for Slot<T> {}

#[repr(C, align(64))]
pub struct Bus<T> {
    buffer: Box<[Slot<T>; RING_SIZE]>,
    _pad0: [u8; CACHE_LINE - 8],
    head: AtomicUsize,
    _pad1: [u8; CACHE_LINE - std::mem::size_of::<AtomicUsize>()],
    tail: AtomicUsize,
    _pad2: [u8; CACHE_LINE - std::mem::size_of::<AtomicUsize>()],
    capacity: usize,
}

impl<T> Bus<T> {
    #[inline]
    pub fn new() -> Self {
        let buffer = unsafe {
            let mut buf: Box<[Slot<T>; RING_SIZE]> = Box::new_uninit().assume_init();
            for (i, slot) in buf.iter_mut().enumerate() {
                slot.sequence = AtomicU64::new(i as u64);
                slot.value = UnsafeCell::new(MaybeUninit::uninit());
            }
            buf
        };

        Self {
            buffer,
            _pad0: [0u8; CACHE_LINE - 8],
            head: AtomicUsize::new(0),
            _pad1: [0u8; CACHE_LINE - std::mem::size_of::<AtomicUsize>()],
            tail: AtomicUsize::new(0),
            _pad2: [0u8; CACHE_LINE - std::mem::size_of::<AtomicUsize>()],
            capacity: RING_SIZE,
        }
    }

    #[inline(always)]
    pub fn try_send(&self, value: T) -> Result<(), T> {
        let mut pos = self.tail.load(Ordering::Relaxed);
        
        loop {
            let slot = &self.buffer[pos & (self.capacity - 1)];
            let seq = slot.sequence.load(Ordering::Acquire);
            let diff = seq as isize - pos as isize;

            if diff == 0 {
                match self.tail.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        unsafe {
                            (*slot.value.get()).write(value);
                        }
                        slot.sequence.store(pos.wrapping_add(1) as u64, Ordering::Release);
                        return Ok(());
                    }
                    Err(actual) => pos = actual,
                }
            } else if diff < 0 {
                return Err(value);
            } else {
                pos = self.tail.load(Ordering::Relaxed);
            }
        }
    }

    #[inline(always)]
    pub fn try_recv(&self) -> Option<T> {
        let mut pos = self.head.load(Ordering::Relaxed);

        loop {
            let slot = &self.buffer[pos & (self.capacity - 1)];
            let seq = slot.sequence.load(Ordering::Acquire);
            let diff = seq as isize - (pos.wrapping_add(1)) as isize;

            if diff == 0 {
                match self.head.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        let value = unsafe { (*slot.value.get()).assume_init_read() };
                        slot.sequence.store(
                            pos.wrapping_add(self.capacity) as u64,
                            Ordering::Release,
                        );
                        return Some(value);
                    }
                    Err(actual) => pos = actual,
                }
            } else if diff < 0 {
                return None;
            } else {
                pos = self.head.load(Ordering::Relaxed);
            }
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        let tail = self.tail.load(Ordering::Acquire);
        let head = self.head.load(Ordering::Acquire);
        tail.wrapping_sub(head)
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl<T> Drop for Bus<T> {
    fn drop(&mut self) {
        while self.try_recv().is_some() {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mpmc_basic() {
        let bus = Bus::new();
        assert!(bus.try_send(42u64).is_ok());
        assert_eq!(bus.try_recv(), Some(42u64));
        assert_eq!(bus.try_recv(), None);
    }

    #[test]
    fn test_mpmc_concurrent() {
        use std::sync::Arc;
        use std::thread;

        let bus = Arc::new(Bus::new());
        let producers = 4;
        let consumers = 4;
        let messages = 10000;

        let mut handles = vec![];

        for p in 0..producers {
            let bus = Arc::clone(&bus);
            handles.push(thread::spawn(move || {
                for i in 0..messages {
                    let val = (p * messages + i) as u64;
                    while bus.try_send(val).is_err() {
                        std::hint::spin_loop();
                    }
                }
            }));
        }

        for _ in 0..consumers {
            let bus = Arc::clone(&bus);
            handles.push(thread::spawn(move || {
                let mut count = 0;
                while count < (messages * producers / consumers) {
                    if bus.try_recv().is_some() {
                        count += 1;
                    } else {
                        std::hint::spin_loop();
                    }
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert!(bus.is_empty());
    }
}
