#![no_main]

use libfuzzer_sys::fuzz_target;
use klyn_sandbox::{
    ipc_ring::{decode_ipc_frame, RING_MAX_PAYLOAD_BYTES},
    supervisor::decode_worker_response,
};

fuzz_target!(|input: &[u8]| {
    // Bound the maximum allocation/work per testcase. Both decoders are pure
    // parsers and must turn malformed bytes into errors, never panics.
    if input.len() > RING_MAX_PAYLOAD_BYTES + std::mem::size_of::<u32>() {
        return;
    }

    let _ = decode_worker_response(input);
    if let Ok(payload) = decode_ipc_frame(input) {
        let _ = decode_worker_response(payload);
    }
});
