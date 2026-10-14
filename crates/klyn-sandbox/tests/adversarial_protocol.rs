#![cfg(target_os = "linux")]

use std::{fs, io::Write};

use ed25519_dalek::SigningKey;
use klyn_sandbox::{
    ipc_ring::{decode_ipc_frame, RING_MAX_PAYLOAD_BYTES},
    kel::{
        hash_payload, KelAttestationChallenge, KelEventKind, KelEvent, KelJournal,
        KEL_EVENT_ENCODED_LEN, KEL_RESPONSE_FRAME_LEN,
    },
    supervisor::decode_worker_response,
};

#[test]
fn ipc_length_prefix_and_control_frames_reject_malformed_inputs() {
    assert!(decode_ipc_frame(&[]).is_err());
    assert!(decode_ipc_frame(&[0; 3]).is_err());
    assert!(decode_ipc_frame(&0u32.to_le_bytes()).is_err());

    let oversized = ((RING_MAX_PAYLOAD_BYTES as u32) + 1).to_le_bytes();
    assert!(decode_ipc_frame(&oversized).is_err());

    let payload = [0x81, 0x34, 0x12, 0, 0, 1];
    let mut packet = (payload.len() as u32).to_le_bytes().to_vec();
    packet.extend_from_slice(&payload);
    assert_eq!(decode_ipc_frame(&packet).expect("valid frame"), payload);
    packet.push(0xff);
    assert!(decode_ipc_frame(&packet).is_err());

    assert!(decode_worker_response(&[]).is_err());
    assert!(decode_worker_response(&[0x81, 0, 0, 0, 0, 2]).is_err());
    assert!(decode_worker_response(&[0x81, 0, 0, 0, 0]).is_err());
    assert!(decode_worker_response(&[0xff]).is_err());
    assert!(decode_worker_response(&[0x82]).is_ok());
}

#[test]
fn kel_transition_and_encoded_signature_tampering_fail_closed() {
    let parent = tempfile::tempdir().expect("journal fixture");
    let path = parent.path().join("adversarial.kel");
    let key = SigningKey::from_bytes(&[0x37; 32]);
    let session = [0x41; 16];
    let mut journal = KelJournal::create(&path, &key, session).expect("create journal");

    assert!(journal
        .append(KelEventKind::Spawn, hash_payload(b"spawn-first"))
        .is_err());
    journal
        .append(
            KelEventKind::CapabilityValidated,
            hash_payload(b"capability"),
        )
        .expect("first event must establish the capability decision");
    assert!(journal
        .append(KelEventKind::PolicyGateClear, hash_payload(b"gate-too-early"))
        .is_err());
    journal
        .append(KelEventKind::Spawn, hash_payload(b"spawn"))
        .expect("capability may transition to spawn");

    let encoded = fs::read(&path).expect("read encoded journal");
    assert_eq!(encoded.len(), 2 * KEL_EVENT_ENCODED_LEN);
    let verified = KelJournal::verify_encoded_chain(
        &encoded,
        &key.verifying_key(),
        Some(journal.head_root()),
    )
    .expect("untampered chain verifies");
    assert_eq!(verified.events.len(), 2);

    // Record layout: sequence, timestamp, kind, session, payload hash,
    // predecessor hash, event hash, signer public key, then 64-byte signature.
    let signature_offset = 8 + 8 + 1 + 16 + 32 + 32 + 32 + 32;
    let mut corrupt = encoded;
    corrupt[signature_offset] ^= 0x80;
    assert!(KelJournal::verify_encoded_chain(&corrupt, &key.verifying_key(), None).is_err());
    assert!(KelEvent::decode_record(&corrupt[..KEL_EVENT_ENCODED_LEN]).is_ok());
    assert!(KelEvent::decode_record(&corrupt[..KEL_EVENT_ENCODED_LEN - 1]).is_err());
}

#[test]
fn challenge_response_cannot_be_replayed_against_a_different_nonce() {
    let worker = SigningKey::from_bytes(&[0x5a; 32]);
    let challenge = KelAttestationChallenge {
        session_id: [0x10; 16],
        nonce: [0xa5; 32],
        launcher_pid: 4321,
        cgroup_id: 9876,
        manifest_hash: [0x11; 32],
        capability_hash: [0x22; 32],
        executable_hash: [0x33; 32],
        daemon_public_key: [0x44; 32],
    };
    let mut response = [0u8; KEL_RESPONSE_FRAME_LEN];
    challenge.build_worker_response(&worker, &mut response);
    assert!(challenge.verify_worker_response(&response).is_ok());

    let mut changed_nonce = challenge;
    changed_nonce.nonce[0] ^= 1;
    assert!(changed_nonce.verify_worker_response(&response).is_err());

    response[0] ^= 0xff;
    assert!(challenge.verify_worker_response(&response).is_err());
}
