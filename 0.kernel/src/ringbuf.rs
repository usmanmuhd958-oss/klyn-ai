//! =============================================================================
//! KLYN AI OS — 0.kernel (Rust Heart) — Genesis V670 atomic ring buffer
//! File: 0.kernel/src/ringbuf.rs
//!
//! A bounded single-producer / single-consumer ring buffer with atomic cursors.
//! This is the Rust counterpart of `genesis/v670/ipc/ring-buffer.ts` (the
//! TypeScript reference implementation) so semantics are identical and
//! testable in pure JS.
//!
//! Contract (must be upheld by callers):
//!   - Exactly ONE producer thread calls `push`.
//!   - Exactly ONE consumer thread calls `pop`.
//!   - Capacity is rounded up to the next power of two (mask-based indexing).
//!
//! Overwrite semantics: when `overwrite` is true and the buffer is full,
//! `push` advances the read cursor and reuses the oldest slot; otherwise the
//! write is counted as `dropped`.
//! =============================================================================

use parking_lot::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct RingBuffer<T> {
    slots: Mutex<Vec<Option<T>>>,
    capacity: usize,
    mask: usize,
    head: AtomicUsize, // read cursor
    tail: AtomicUsize, // write cursor
    overwrite: bool,
    dropped: AtomicUsize,
    overwritten: AtomicUsize,
}

impl<T> RingBuffer<T> {
    /// Create a new ring buffer with `capacity` slots (power-of-two rounded).
    pub fn new(capacity: usize, overwrite: bool) -> Self {
        let capacity = capacity.next_power_of_two().max(2);
        let mut slots = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            slots.push(None);
        }
        Self {
            slots: Mutex::new(slots),
            capacity,
            mask: capacity - 1,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            overwrite,
            dropped: AtomicUsize::new(0),
            overwritten: AtomicUsize::new(0),
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Push an item. Returns `false` when full and `overwrite` is disabled.
    pub fn push(&self, item: T) -> bool {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);

        if tail.wrapping_sub(head) >= self.capacity {
            if !self.overwrite {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                return false;
            }
            // Overwrite the oldest slot by advancing the read cursor.
            self.head.fetch_add(1, Ordering::Release);
            self.overwritten.fetch_add(1, Ordering::Relaxed);
        }

        let idx = tail & self.mask;
        self.slots.lock()[idx] = Some(item);
        self.tail.fetch_add(1, Ordering::Release);
        true
    }

    /// Pop the oldest item. Returns `None` when empty.
    pub fn pop(&self) -> Option<T> {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        if head == tail {
            return None;
        }
        let idx = head & self.mask;
        let item = self.slots.lock()[idx].take();
        self.head.fetch_add(1, Ordering::Release);
        item
    }

    /// Number of items currently in the buffer.
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);
        tail.wrapping_sub(head).min(self.capacity)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Total writes rejected because the buffer was full.
    pub fn dropped(&self) -> usize {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Total slots reused via overwrite policy.
    pub fn overwritten(&self) -> usize {
        self.overwritten.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_pop_fifo() {
        let buf = RingBuffer::new(4, false);
        assert!(buf.is_empty());
        assert!(buf.push(1));
        assert!(buf.push(2));
        assert!(buf.push(3));
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.pop(), Some(1));
        assert_eq!(buf.pop(), Some(2));
        assert_eq!(buf.pop(), Some(3));
        assert_eq!(buf.pop(), None);
    }

    #[test]
    fn full_drops_without_overwrite() {
        let buf = RingBuffer::new(4, false);
        for i in 0..4 {
            assert!(buf.push(i));
        }
        assert!(!buf.push(99));
        assert_eq!(buf.dropped(), 1);
        assert_eq!(buf.pop(), Some(0));
    }

    #[test]
    fn overwrite_reuses_oldest() {
        let buf = RingBuffer::new(4, true);
        for i in 0..4 {
            assert!(buf.push(i));
        }
        assert!(buf.push(99));
        assert_eq!(buf.overwritten(), 1);
        assert_eq!(buf.pop(), Some(1));
        assert_eq!(buf.pop(), Some(2));
        assert_eq!(buf.pop(), Some(3));
        assert_eq!(buf.pop(), Some(99));
    }
}
