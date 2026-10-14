//! Bounded cross-process SPSC rings backed by sealed-size memfds.
//!
//! The data plane allocates nothing after endpoint initialization. Each ring
//! uses separate payload/head/tail memfds so that a producer can write payload
//! and its head counter, while the consumer can only read payload/head and
//! write its tail counter. The worker receives only the endpoint descriptors
//! needed for its direction; the supervisor remains responsible for killing
//! the worker cgroup if a protocol or integrity error is observed.
//!
//! Safety invariants:
//! * Only one producer may publish to a ring and only one consumer may retire
//!   entries. A reservation exclusively borrows its endpoint.
//! * The producer writes a slot completely before publishing head with Release.
//!   The consumer observes head with Acquire and retires it with Release. The
//!   producer observes tail with Acquire before reusing a slot.
//! * Ring geometry is fixed at compile time. File sizes and required memfd seals
//!   are validated before any mapping, and every externally supplied length is
//!   checked before a payload pointer is formed.
//! * Counter pages are separate memfds. Each endpoint maps its owned counter
//!   read/write and the other counter read-only. Payload is writable only in the
//!   producer mapping and read-only in the consumer mapping.
//! * The cross-process contract relies on Linux shared mappings and lock-free
//!   32-bit atomics/futexes. It is not a security boundary against arbitrary
//!   native code executing inside either endpoint; workers remain sandboxed and
//!   all decoded messages must still be treated as untrusted.

use std::{
    ffi::CString,
    fs::OpenOptions,
    io,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::fs::OpenOptionsExt,
    },
    ptr::{self, NonNull},
    slice,
    sync::atomic::{AtomicU32, Ordering},
    time::{Duration, Instant},
};

use crate::SandboxError;

pub const RING_SLOT_COUNT: usize = 8;
pub const RING_MAX_PAYLOAD_BYTES: usize = 64 * 1024;

/// Fixed inherited descriptor layout used by the trusted stage-0 launcher.
pub const COMMAND_RING_PAYLOAD_FD: RawFd = 7;
pub const COMMAND_RING_HEAD_FD: RawFd = 8;
pub const COMMAND_RING_TAIL_FD: RawFd = 9;
pub const RESPONSE_RING_PAYLOAD_FD: RawFd = 10;
pub const RESPONSE_RING_HEAD_FD: RawFd = 11;
pub const RESPONSE_RING_TAIL_FD: RawFd = 12;

pub const WORKER_CMD_PING: u8 = 0x01;
pub const WORKER_CMD_SHUTDOWN: u8 = 0x02;
pub const WORKER_RESP_PING: u8 = 0x81;
pub const WORKER_RESP_SHUTDOWN: u8 = 0x82;

const LEN_PREFIX_BYTES: usize = std::mem::size_of::<u32>();
const SLOT_STRIDE: usize = align_up(LEN_PREFIX_BYTES + RING_MAX_PAYLOAD_BYTES, 64);
const FUTEX_WAIT_OP: libc::c_int = 0;
const FUTEX_WAKE_OP: libc::c_int = 1;
const REQUIRED_SEALS: libc::c_int =
    libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL;

const _: () = assert!(RING_SLOT_COUNT.is_power_of_two());

const fn align_up(value: usize, alignment: usize) -> usize {
    (value + alignment - 1) & !(alignment - 1)
}

fn payload_mapping_len() -> usize {
    RING_SLOT_COUNT * SLOT_STRIDE
}

fn counter_mapping_len() -> Result<usize, SandboxError> {
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page_size <= 0 || (page_size as usize) < std::mem::size_of::<AtomicU32>() {
        return Err(SandboxError::Enforcement(
            "kernel returned an invalid page size for shared IPC".into(),
        ));
    }
    Ok(page_size as usize)
}

struct Mapping {
    ptr: NonNull<u8>,
    len: usize,
}

impl Mapping {
    fn new(fd: &OwnedFd, len: usize, writable: bool) -> Result<Self, SandboxError> {
        validate_memfd(fd.as_raw_fd(), len)?;
        let protection = if writable {
            libc::PROT_READ | libc::PROT_WRITE
        } else {
            libc::PROT_READ
        };
        let raw = unsafe {
            libc::mmap(
                ptr::null_mut(),
                len,
                protection,
                libc::MAP_SHARED,
                fd.as_raw_fd(),
                0,
            )
        };
        if raw == libc::MAP_FAILED {
            return Err(SandboxError::Io(io::Error::last_os_error()));
        }
        let Some(ptr) = NonNull::new(raw.cast::<u8>()) else {
            unsafe {
                libc::munmap(raw, len);
            }
            return Err(SandboxError::Enforcement(
                "mmap returned a null shared IPC address".into(),
            ));
        };
        Ok(Self { ptr, len })
    }

    fn as_ptr(&self) -> *mut u8 {
        self.ptr.as_ptr()
    }
}

// SAFETY: a Mapping owns its virtual-memory mapping; endpoint APIs require
// exclusive mutable access to their producer/consumer state and do not expose
// Sync. The shared-memory ordering contract is enforced by the ring atomics.
unsafe impl Send for Mapping {}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.ptr.as_ptr().cast(), self.len);
        }
    }
}

/// Descriptors for the consumer endpoint. The payload and head descriptors are
/// read-only; the tail descriptor is writable only by the consumer.
pub(crate) struct ConsumerRingFds {
    payload: OwnedFd,
    head: OwnedFd,
    tail: OwnedFd,
}

impl ConsumerRingFds {
    pub(crate) fn raw_fds(&self) -> [RawFd; 3] {
        [
            self.payload.as_raw_fd(),
            self.head.as_raw_fd(),
            self.tail.as_raw_fd(),
        ]
    }
}

/// Descriptors for the producer endpoint. The payload and head descriptors are
/// writable; the tail descriptor is read-only.
pub(crate) struct ProducerRingFds {
    payload: OwnedFd,
    head: OwnedFd,
    tail: OwnedFd,
}

impl ProducerRingFds {
    pub(crate) fn raw_fds(&self) -> [RawFd; 3] {
        [
            self.payload.as_raw_fd(),
            self.head.as_raw_fd(),
            self.tail.as_raw_fd(),
        ]
    }
}

pub struct RingProducer {
    payload: Mapping,
    _head_mapping: Mapping,
    _tail_mapping: Mapping,
    head: *mut AtomicU32,
    tail: *const AtomicU32,
}

// SAFETY: moving the endpoint transfers exclusive ownership of its producer
// state. It is not Sync and each method requires &mut self.
unsafe impl Send for RingProducer {}

impl RingProducer {
    /// Create a producer mapping and the permission-restricted consumer
    /// descriptors that may be inherited by another process.
    pub(crate) fn create() -> Result<(Self, ConsumerRingFds), SandboxError> {
        let payload_len = payload_mapping_len();
        let counter_len = counter_mapping_len()?;
        let (payload_rw, payload_ro) = create_memfd_pair("klyn-ipc-payload", payload_len)?;
        let (head_rw, head_ro) = create_memfd_pair("klyn-ipc-head", counter_len)?;
        let (tail_rw, tail_ro) = create_memfd_pair("klyn-ipc-tail", counter_len)?;

        // SAFETY: these memfds are newly created, uniquely owned, and not yet
        // exposed to another process. Initialize real AtomicU32 objects before
        // either endpoint obtains a mapping to the counters.
        initialize_counter(&head_rw, counter_len)?;
        initialize_counter(&tail_rw, counter_len)?;

        let payload_mapping = Mapping::new(&payload_rw, payload_len, true)?;
        let head_mapping = Mapping::new(&head_rw, counter_len, true)?;
        let tail_mapping = Mapping::new(&tail_ro, counter_len, false)?;
        let head = head_mapping.as_ptr().cast::<AtomicU32>();
        let tail = tail_mapping.as_ptr().cast::<AtomicU32>();
        let producer = Self {
            payload: payload_mapping,
            _head_mapping: head_mapping,
            _tail_mapping: tail_mapping,
            head,
            tail,
        };
        // Mappings survive closing the local backing descriptors.
        drop(payload_rw);
        drop(head_rw);
        drop(tail_ro);

        Ok((
            producer,
            ConsumerRingFds {
                payload: payload_ro,
                head: head_ro,
                tail: tail_rw,
            },
        ))
    }

    /// Attach a producer endpoint from descriptors created by RingConsumer.
    pub(crate) fn attach(fds: ProducerRingFds) -> Result<Self, SandboxError> {
        let payload_len = payload_mapping_len();
        let counter_len = counter_mapping_len()?;
        let payload_mapping = Mapping::new(&fds.payload, payload_len, true)?;
        let head_mapping = Mapping::new(&fds.head, counter_len, true)?;
        let tail_mapping = Mapping::new(&fds.tail, counter_len, false)?;
        let head = head_mapping.as_ptr().cast::<AtomicU32>();
        let tail = tail_mapping.as_ptr().cast::<AtomicU32>();
        let producer = Self {
            payload: payload_mapping,
            _head_mapping: head_mapping,
            _tail_mapping: tail_mapping,
            head,
            tail,
        };
        // SAFETY: each Mapping retains its own mmap; closing the inherited
        // backing descriptors does not unmap any of the mappings.
        drop(fds);
        Ok(producer)
    }

    /// Take ownership of the three trusted descriptors inherited by klyn-worker.
    ///
    /// # Safety
    /// The caller must ensure the descriptor numbers are open, distinct, refer
    /// to the correct producer endpoint files, and are not owned by another
    /// OwnedFd value. Ownership of all three descriptors transfers to this call.
    pub(crate) unsafe fn from_inherited_fds(
        payload_fd: RawFd,
        head_fd: RawFd,
        tail_fd: RawFd,
    ) -> Result<Self, SandboxError> {
        if payload_fd == head_fd || payload_fd == tail_fd || head_fd == tail_fd {
            return Err(SandboxError::Enforcement(
                "shared IPC endpoint descriptors must be distinct".into(),
            ));
        }
        for fd in [payload_fd, head_fd, tail_fd] {
            if libc::fcntl(fd, libc::F_GETFD) < 0 {
                return Err(SandboxError::Enforcement(format!(
                    "required shared IPC descriptor {fd} is unavailable"
                )));
            }
        }
        let fds = ProducerRingFds {
            payload: OwnedFd::from_raw_fd(payload_fd),
            head: OwnedFd::from_raw_fd(head_fd),
            tail: OwnedFd::from_raw_fd(tail_fd),
        };
        Self::attach(fds)
    }

    pub fn try_reserve(&mut self) -> Result<Option<ProducerReservation<'_>>, SandboxError> {
        let head = unsafe { &*self.head }.load(Ordering::Relaxed);
        let tail = unsafe { &*self.tail }.load(Ordering::Acquire);
        let used = head.wrapping_sub(tail);
        if used > RING_SLOT_COUNT as u32 {
            return Err(SandboxError::Enforcement(
                "shared IPC producer observed corrupt head/tail distance".into(),
            ));
        }
        if used == RING_SLOT_COUNT as u32 {
            return Ok(None);
        }

        let index = (head as usize) & (RING_SLOT_COUNT - 1);
        let slot = unsafe { self.payload.as_ptr().add(index * SLOT_STRIDE) };
        Ok(Some(ProducerReservation {
            ring: self,
            slot,
            sequence: head,
        }))
    }

    /// Copy bytes into the next slot without allocating. For callers that can
    /// encode directly into shared memory, use try_reserve instead.
    pub fn try_push(&mut self, bytes: &[u8]) -> Result<bool, SandboxError> {
        if bytes.is_empty() || bytes.len() > RING_MAX_PAYLOAD_BYTES {
            return Err(SandboxError::InvalidConfig(
                "shared IPC frame length is outside the permitted bounds".into(),
            ));
        }
        let Some(mut reservation) = self.try_reserve()? else {
            return Ok(false);
        };
        reservation.buffer()[..bytes.len()].copy_from_slice(bytes);
        reservation.commit(bytes.len())?;
        Ok(true)
    }

    /// Wait for capacity and publish bytes. The timeout bounds shutdown paths;
    /// this method performs no heap allocation.
    pub fn push_wait(&mut self, bytes: &[u8], timeout: Duration) -> Result<(), SandboxError> {
        if bytes.is_empty() || bytes.len() > RING_MAX_PAYLOAD_BYTES {
            return Err(SandboxError::InvalidConfig(
                "shared IPC frame length is outside the permitted bounds".into(),
            ));
        }
        let deadline = Instant::now().checked_add(timeout).ok_or_else(|| {
            SandboxError::InvalidConfig("shared IPC timeout is too large".into())
        })?;
        loop {
            if let Some(mut reservation) = self.try_reserve()? {
                reservation.buffer()[..bytes.len()].copy_from_slice(bytes);
                reservation.commit(bytes.len())?;
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(SandboxError::Enforcement(
                    "timed out waiting for shared IPC ring capacity".into(),
                ));
            }
            let expected_tail = unsafe { &*self.tail }.load(Ordering::Acquire);
            futex_wait(self.tail, expected_tail, Some(remaining))?;
        }
    }
}

pub struct RingConsumer {
    payload: Mapping,
    _head_mapping: Mapping,
    _tail_mapping: Mapping,
    head: *const AtomicU32,
    tail: *mut AtomicU32,
}

// SAFETY: moving the endpoint transfers exclusive ownership of its consumer
// state. It is not Sync and each method requires &mut self.
unsafe impl Send for RingConsumer {}

impl RingConsumer {
    /// Create a consumer mapping and the permission-restricted producer
    /// descriptors that may be inherited by another process.
    pub(crate) fn create() -> Result<(Self, ProducerRingFds), SandboxError> {
        let payload_len = payload_mapping_len();
        let counter_len = counter_mapping_len()?;
        let (payload_rw, payload_ro) = create_memfd_pair("klyn-ipc-payload", payload_len)?;
        let (head_rw, head_ro) = create_memfd_pair("klyn-ipc-head", counter_len)?;
        let (tail_rw, tail_ro) = create_memfd_pair("klyn-ipc-tail", counter_len)?;

        // SAFETY: these memfds are newly created, uniquely owned, and not yet
        // exposed to another process. Initialize real AtomicU32 objects before
        // either endpoint obtains a mapping to the counters.
        initialize_counter(&head_rw, counter_len)?;
        initialize_counter(&tail_rw, counter_len)?;

        let payload_mapping = Mapping::new(&payload_ro, payload_len, false)?;
        let head_mapping = Mapping::new(&head_ro, counter_len, false)?;
        let tail_mapping = Mapping::new(&tail_rw, counter_len, true)?;
        let head = head_mapping.as_ptr().cast::<AtomicU32>();
        let tail = tail_mapping.as_ptr().cast::<AtomicU32>();
        let consumer = Self {
            payload: payload_mapping,
            _head_mapping: head_mapping,
            _tail_mapping: tail_mapping,
            head,
            tail,
        };
        drop(payload_ro);
        drop(head_ro);
        drop(tail_rw);

        Ok((
            consumer,
            ProducerRingFds {
                payload: payload_rw,
                head: head_rw,
                tail: tail_ro,
            },
        ))
    }

    /// Attach a consumer endpoint from descriptors created by RingProducer.
    pub(crate) fn attach(fds: ConsumerRingFds) -> Result<Self, SandboxError> {
        let payload_len = payload_mapping_len();
        let counter_len = counter_mapping_len()?;
        let payload_mapping = Mapping::new(&fds.payload, payload_len, false)?;
        let head_mapping = Mapping::new(&fds.head, counter_len, false)?;
        let tail_mapping = Mapping::new(&fds.tail, counter_len, true)?;
        let head = head_mapping.as_ptr().cast::<AtomicU32>();
        let tail = tail_mapping.as_ptr().cast::<AtomicU32>();
        let consumer = Self {
            payload: payload_mapping,
            _head_mapping: head_mapping,
            _tail_mapping: tail_mapping,
            head,
            tail,
        };
        drop(fds);
        Ok(consumer)
    }

    /// Take ownership of the three trusted descriptors inherited by klyn-worker.
    ///
    /// # Safety
    /// The caller must ensure the descriptor numbers are open, distinct, refer
    /// to the correct consumer endpoint files, and are not owned by another
    /// OwnedFd value. Ownership of all three descriptors transfers to this call.
    pub(crate) unsafe fn from_inherited_fds(
        payload_fd: RawFd,
        head_fd: RawFd,
        tail_fd: RawFd,
    ) -> Result<Self, SandboxError> {
        if payload_fd == head_fd || payload_fd == tail_fd || head_fd == tail_fd {
            return Err(SandboxError::Enforcement(
                "shared IPC endpoint descriptors must be distinct".into(),
            ));
        }
        for fd in [payload_fd, head_fd, tail_fd] {
            if libc::fcntl(fd, libc::F_GETFD) < 0 {
                return Err(SandboxError::Enforcement(format!(
                    "required shared IPC descriptor {fd} is unavailable"
                )));
            }
        }
        let fds = ConsumerRingFds {
            payload: OwnedFd::from_raw_fd(payload_fd),
            head: OwnedFd::from_raw_fd(head_fd),
            tail: OwnedFd::from_raw_fd(tail_fd),
        };
        Self::attach(fds)
    }

    pub fn try_peek(&mut self) -> Result<Option<ConsumerReservation<'_>>, SandboxError> {
        let head = unsafe { &*self.head }.load(Ordering::Acquire);
        let tail = unsafe { &*self.tail }.load(Ordering::Relaxed);
        let available = head.wrapping_sub(tail);
        if available > RING_SLOT_COUNT as u32 {
            return Err(SandboxError::Enforcement(
                "shared IPC consumer observed corrupt head/tail distance".into(),
            ));
        }
        if available == 0 {
            return Ok(None);
        }

        let index = (tail as usize) & (RING_SLOT_COUNT - 1);
        let slot = unsafe { self.payload.as_ptr().add(index * SLOT_STRIDE) };
        let length = unsafe { ptr::read(slot.cast::<u32>()) } as usize;
        if length == 0 || length > RING_MAX_PAYLOAD_BYTES {
            return Err(SandboxError::Enforcement(
                "shared IPC slot contains an invalid frame length".into(),
            ));
        }
        Ok(Some(ConsumerReservation {
            ring: self,
            slot,
            sequence: tail,
            length,
        }))
    }

    /// Wait until an item is available or the optional timeout expires.
    /// Passing None waits until a producer publishes data or the wait is
    /// interrupted by a protocol error in the calling process.
    pub fn wait_peek(
        &mut self,
        timeout: Option<Duration>,
    ) -> Result<Option<ConsumerReservation<'_>>, SandboxError> {
        let deadline = match timeout {
            Some(duration) => Some(Instant::now().checked_add(duration).ok_or_else(|| {
                SandboxError::InvalidConfig("shared IPC timeout is too large".into())
            })?),
            None => None,
        };
        loop {
            if let Some(slot) = self.try_peek()? {
                return Ok(Some(slot));
            }
            let remaining = match deadline {
                Some(end) => {
                    let remaining = end.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        return Ok(None);
                    }
                    Some(remaining)
                }
                None => None,
            };
            let expected_head = unsafe { &*self.head }.load(Ordering::Acquire);
            futex_wait(self.head, expected_head, remaining)?;
        }
    }
}

pub struct ProducerReservation<'a> {
    ring: &'a mut RingProducer,
    slot: *mut u8,
    sequence: u32,
}

impl ProducerReservation<'_> {
    /// Direct writable view into the reserved shared-memory slot.
    pub fn buffer(&mut self) -> &mut [u8] {
        unsafe {
            // SAFETY: this slot is exclusively reserved by the sole producer;
            // the payload length is fixed and the index is masked by capacity.
            slice::from_raw_parts_mut(self.slot.add(LEN_PREFIX_BYTES), RING_MAX_PAYLOAD_BYTES)
        }
    }

    /// Publish the reserved payload. Consumers cannot observe the payload until
    /// the Release store publishes the incremented producer sequence.
    pub fn commit(self, length: usize) -> Result<(), SandboxError> {
        if length == 0 || length > RING_MAX_PAYLOAD_BYTES {
            return Err(SandboxError::InvalidConfig(
                "shared IPC commit length is outside the permitted bounds".into(),
            ));
        }
        unsafe {
            // SAFETY: the producer exclusively owns the unpublished slot, and
            // the slot base is aligned to 64 bytes, so its u32 prefix is aligned.
            ptr::write(self.slot.cast::<u32>(), length as u32);
            (&*self.ring.head).store(self.sequence.wrapping_add(1), Ordering::Release);
        }
        futex_wake(self.ring.head)?;
        Ok(())
    }
}

pub struct ConsumerReservation<'a> {
    ring: &'a mut RingConsumer,
    slot: *mut u8,
    sequence: u32,
    length: usize,
}

impl ConsumerReservation<'_> {
    /// Read-only view of the published frame. Consume it before the producer
    /// may reuse the slot.
    pub fn payload(&self) -> &[u8] {
        unsafe {
            // SAFETY: Acquire observed the publication store; this slot remains
            // unavailable to the producer until consume() stores the new tail.
            // Producer and consumer roles are single-owner and the shared
            // payload mapping is read-only for this endpoint.
            slice::from_raw_parts(self.slot.add(LEN_PREFIX_BYTES), self.length)
        }
    }

    pub fn consume(self) -> Result<(), SandboxError> {
        unsafe {
            // SAFETY: this reservation is the next consumer slot and &mut self
            // prevents a second reservation from retiring the same sequence.
            (&*self.ring.tail).store(self.sequence.wrapping_add(1), Ordering::Release);
        }
        futex_wake(self.ring.tail)?;
        Ok(())
    }
}

fn initialize_counter(fd: &OwnedFd, counter_len: usize) -> Result<(), SandboxError> {
    let mapping = Mapping::new(fd, counter_len, true)?;
    // SAFETY: fd is a fresh, exclusively owned counter memfd. No endpoint has
    // been created or shared yet, and the mmap is page-aligned and writable.
    unsafe {
        ptr::write(mapping.as_ptr().cast::<AtomicU32>(), AtomicU32::new(0));
    }
    Ok(())
}

fn create_memfd_pair(name: &str, size: usize) -> Result<(OwnedFd, OwnedFd), SandboxError> {
    let writable = create_memfd(name, size)?;
    let readonly = reopen_read_only(&writable)?;
    Ok((writable, readonly))
}

fn create_memfd(name: &str, size: usize) -> Result<OwnedFd, SandboxError> {
    let name = CString::new(name)
        .map_err(|_| SandboxError::InvalidConfig("invalid shared IPC memfd name".into()))?;
    let flags = (libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING) as libc::c_uint;
    let raw = unsafe { libc::syscall(libc::SYS_memfd_create, name.as_ptr(), flags) as RawFd };
    if raw < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    // SAFETY: memfd_create returned a new, open descriptor owned by this call.
    let fd = unsafe { OwnedFd::from_raw_fd(raw) };
    if unsafe { libc::ftruncate(fd.as_raw_fd(), size as libc::off_t) } != 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    if unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_ADD_SEALS, REQUIRED_SEALS) } < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    Ok(fd)
}

fn reopen_read_only(fd: &OwnedFd) -> Result<OwnedFd, SandboxError> {
    let path = format!("/proc/self/fd/{}", fd.as_raw_fd());
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(path)?;
    Ok(file.into())
}

fn validate_memfd(fd: RawFd, expected_len: usize) -> Result<(), SandboxError> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::zeroed();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    let stat = unsafe { stat.assume_init() };
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG
        || stat.st_size < 0
        || stat.st_size as usize != expected_len
    {
        return Err(SandboxError::Enforcement(
            "shared IPC descriptor has an unexpected file type or size".into(),
        ));
    }
    let seals = unsafe { libc::fcntl(fd, libc::F_GET_SEALS) };
    if seals < 0 || seals & REQUIRED_SEALS != REQUIRED_SEALS {
        return Err(SandboxError::Enforcement(
            "shared IPC descriptor is not sealed against resizing".into(),
        ));
    }
    Ok(())
}

fn futex_wait(
    counter: *const AtomicU32,
    expected: u32,
    timeout: Option<Duration>,
) -> Result<(), SandboxError> {
    let mut timespec = timeout.map(|duration| libc::timespec {
        tv_sec: duration.as_secs().min(i64::MAX as u64) as libc::time_t,
        tv_nsec: duration.subsec_nanos() as libc::c_long,
    });
    let timeout_ptr = timespec
        .as_mut()
        .map_or(ptr::null(), |value| value as *const libc::timespec);
    let result = unsafe {
        libc::syscall(
            libc::SYS_futex,
            counter.cast::<u32>(),
            FUTEX_WAIT_OP,
            expected,
            timeout_ptr,
            ptr::null::<u32>(),
            0,
        )
    };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EAGAIN | libc::EINTR | libc::ETIMEDOUT) => Ok(()),
        _ => Err(SandboxError::Io(error)),
    }
}

fn futex_wake(counter: *const AtomicU32) -> Result<(), SandboxError> {
    let result = unsafe {
        libc::syscall(
            libc::SYS_futex,
            counter.cast::<u32>(),
            FUTEX_WAKE_OP,
            1,
            ptr::null::<libc::timespec>(),
            ptr::null::<u32>(),
            0,
        )
    };
    if result < 0 {
        return Err(SandboxError::Io(io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn producer_consumer_roundtrip_uses_shared_memory_without_allocating_payloads() {
        let (mut producer, consumer_fds) = RingProducer::create().expect("create ring");
        let mut consumer = RingConsumer::attach(consumer_fds).expect("attach consumer");
        let payload = b"typed-worker-frame";
        assert!(producer.try_push(payload).expect("publish frame"));

        let frame = consumer
            .wait_peek(Some(Duration::from_secs(1)))
            .expect("wait for frame")
            .expect("frame should be available");
        assert_eq!(frame.payload(), payload);
        frame.consume().expect("retire frame");

        assert!(consumer.try_peek().expect("empty ring check").is_none());
    }

    #[test]
    fn bounded_ring_reports_full_and_recovers_after_consume() {
        let (mut producer, consumer_fds) = RingProducer::create().expect("create ring");
        let mut consumer = RingConsumer::attach(consumer_fds).expect("attach consumer");
        for value in 0..RING_SLOT_COUNT {
            assert!(producer
                .try_push(&[value as u8 + 1])
                .expect("publish bounded frame"));
        }
        assert!(!producer.try_push(b"full").expect("full ring is not corruption"));

        let frame = consumer.try_peek().expect("peek first frame").expect("item");
        assert_eq!(frame.payload(), &[1]);
        frame.consume().expect("consume first frame");
        assert!(producer.try_push(b"next").expect("space recovered"));

        let first_remaining = consumer.try_peek().expect("peek").expect("item");
        assert_eq!(first_remaining.payload(), &[2]);
        first_remaining.consume().expect("consume");
    }

    #[test]
    fn payload_bounds_are_checked_before_any_ring_publication() {
        let (mut producer, consumer_fds) = RingProducer::create().expect("create ring");
        let mut consumer = RingConsumer::attach(consumer_fds).expect("attach consumer");
        let oversized = vec![0u8; RING_MAX_PAYLOAD_BYTES + 1];

        assert!(producer.try_push(&[]).is_err());
        assert!(producer.try_push(&oversized).is_err());
        assert!(consumer.try_peek().expect("ring state remains valid").is_none());
    }

    #[test]
    fn consumer_created_ring_supports_attaching_the_remote_producer() {
        let (mut consumer, producer_fds) = RingConsumer::create().expect("create consumer ring");
        let mut producer =
            RingProducer::attach(producer_fds).expect("attach remote producer endpoint");

        assert!(producer.try_push(b"reverse-direction").expect("publish"));
        let frame = consumer
            .wait_peek(Some(Duration::from_secs(1)))
            .expect("wait")
            .expect("frame available");
        assert_eq!(frame.payload(), b"reverse-direction");
        frame.consume().expect("consume");
    }

    #[test]
    fn wait_peek_respects_a_zero_timeout() {
        let (mut consumer, _producer_fds) =
            RingConsumer::create().expect("create empty ring");
        assert!(consumer
            .wait_peek(Some(Duration::ZERO))
            .expect("zero-timeout poll")
            .is_none());
    }

    #[test]
    fn cross_thread_wait_and_wake_preserves_order_for_many_frames() {
        const TOTAL: u32 = 20_000;
        let (mut producer, consumer_fds) = RingProducer::create().expect("create ring");
        let consumer = RingConsumer::attach(consumer_fds).expect("attach consumer");
        let join = thread::spawn(move || {
            let mut consumer = consumer;
            for expected in 0..TOTAL {
                let frame = consumer
                    .wait_peek(None)
                    .expect("wait for published sequence");
                let frame = frame.expect("infinite wait only returns an item");
                assert_eq!(frame.payload(), &expected.to_le_bytes());
                frame.consume().expect("retire sequence");
            }
        });

        for value in 0..TOTAL {
            producer
                .push_wait(&value.to_le_bytes(), Duration::from_secs(5))
                .expect("publish ordered frame");
        }
        join.join().expect("consumer thread should complete");
    }
}
