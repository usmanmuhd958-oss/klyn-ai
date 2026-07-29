use core::sync::atomic::{AtomicUsize, Ordering};

#[repr(C, align(64))]
pub struct RingBuffer<T: Copy, const N: usize> {
    buffer: Box<[T; N]>,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl<T: Copy + Default, const N: usize> RingBuffer<T, N> {
    #[inline(always)]
    pub fn new() -> Self {
        // Safe heap allocation instead of zeroed uninitialized stack space
        let vec = vec![T::default(); N];
        let boxed_slice = vec.into_boxed_slice();
        let boxed_array = unsafe {
            let ptr = Box::into_raw(boxed_slice) as *mut [T; N];
            Box::from_raw(ptr)
        };

        Self {
            buffer: boxed_array,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    #[inline(always)]
    pub fn push(&mut self, item: T) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Relaxed);
        let next_head = (head + 1) % N;
        
        if next_head == tail {
            return false;
        }
        
        self.buffer[head] = item;
        self.head.store(next_head, Ordering::Release);
        true
    }

    #[inline(always)]
    pub fn pop(&mut self) -> Option<T> {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Relaxed);
        
        if head == tail {
            return None;
        }
        
        let item = self.buffer[tail];
        self.tail.store((tail + 1) % N, Ordering::Release);
        Some(item)
    }
}
