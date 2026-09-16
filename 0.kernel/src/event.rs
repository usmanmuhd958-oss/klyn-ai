use zerocopy::{AsBytes, FromBytes, FromZeroes};

const MAX_PAYLOAD: usize = 4096;

#[repr(C, packed)]
#[derive(Copy, Clone, AsBytes, FromBytes, FromZeroes)]
pub struct Event {
    opcode: u8,
    flags: u8,
    len: u16,
    timestamp: u64,
    payload: [u8; MAX_PAYLOAD],
}

impl Default for Event {
    fn default() -> Self {
        Self {
            opcode: 0,
            flags: 0,
            len: 0,
            timestamp: 0,
            payload: [0u8; MAX_PAYLOAD],
        }
    }
}

impl Event {
    #[inline(always)]
    pub unsafe fn from_raw(ptr: *const u8, len: usize) -> Self {
        let mut event = Self::default();
        if ptr.is_null() || len < 12 {
            return event;
        }

        event.opcode = core::ptr::read_unaligned(ptr);
        event.flags = core::ptr::read_unaligned(ptr.add(1));
        
        let len_bytes = core::ptr::read_unaligned(ptr.add(2) as *const [u8; 2]);
        event.len = u16::from_le_bytes(len_bytes);

        let ts_bytes = core::ptr::read_unaligned(ptr.add(4) as *const [u8; 8]);
        event.timestamp = u64::from_le_bytes(ts_bytes);

        let payload_len = core::cmp::min(len - 12, MAX_PAYLOAD);
        core::ptr::copy_nonoverlapping(
            ptr.add(12),
            event.payload.as_mut_ptr(),
            payload_len
        );

        event
    }

    #[inline(always)]
    pub const fn synthetic() -> Self {
        Self {
            opcode: 0x01,
            flags: 0,
            len: 8,
            timestamp: 0,
            payload: [0u8; MAX_PAYLOAD],
        }
    }

    #[inline(always)]
    pub fn opcode(&self) -> u8 {
        self.opcode
    }

    #[inline(always)]
    pub fn payload(&self) -> &[u8] {
        let l = self.len as usize;
        if l > MAX_PAYLOAD {
            &self.payload[..MAX_PAYLOAD]
        } else {
            &self.payload[..l]
        }
    }
}
