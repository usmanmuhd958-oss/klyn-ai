#![no_main]

use ed25519_dalek::SigningKey;
use klyn_sandbox::kel::{KelEvent, KelJournal, KEL_EVENT_ENCODED_LEN};
use libfuzzer_sys::fuzz_target;

const MAX_FUZZ_CHAIN_RECORDS: usize = 32;
const MAX_FUZZ_CHAIN_BYTES: usize = KEL_EVENT_ENCODED_LEN * MAX_FUZZ_CHAIN_RECORDS;

fuzz_target!(|input: &[u8]| {
    // Keep work bounded while still exercising multi-event chains, ordering,
    // worker lineage, hash chaining, terminal events, and Ed25519 verification.
    if input.len() > MAX_FUZZ_CHAIN_BYTES {
        return;
    }

    let key = SigningKey::from_bytes(&[0x6d; 32]).verifying_key();
    let _ = KelJournal::verify_encoded_chain(input, &key, None);

    if input.len() <= KEL_EVENT_ENCODED_LEN {
        let _ = KelEvent::decode_record(input);
    } else {
        for record in input.chunks(KEL_EVENT_ENCODED_LEN) {
            let _ = KelEvent::decode_record(record);
        }
    }
});
