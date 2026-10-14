//! KEL v1: fixed-width, daemon-signed, append-only worker lifecycle journal.
//!
//! Event records are fixed-width and encoded into stack buffers. The journal
//! is append-only (create_new plus O_APPEND), each record is synced before its
//! root becomes visible, and verification rejects truncation, reordering,
//! mutation, signature failures, and an unanchored head when an expected root
//! is supplied. External/TPM-backed root anchoring is required to detect deletion
//! of an entire journal or rollback of the external head anchor.

use std::{
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

use crate::SandboxError;

const EVENT_DOMAIN: &[u8] = b"KLYN-KEL-EVENT-v1\0";
const ATTESTATION_DOMAIN: &[u8] = b"KLYN-WORKER-ATTEST-v1\0";
const SESSION_DOMAIN: &[u8] = b"KLYN-SESSION-v1\0";
const PROOF_DOMAIN: &[u8] = b"KLYN-ATTESTATION-PROOF-v1\0";

pub const KEL_CHALLENGE_OPCODE: u8 = 0x03;
pub const KEL_RESPONSE_OPCODE: u8 = 0x83;
pub const KEL_CHALLENGE_FRAME_LEN: usize = 189;
pub const KEL_RESPONSE_FRAME_LEN: usize = 97;
pub const KEL_EVENT_ENCODED_LEN: usize = 461;

const ZERO_HASH: [u8; 32] = [0; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum KelEventKind {
    CapabilityValidated = 1,
    Spawn = 2,
    WorkerAttested = 3,
    PolicyGateClear = 4,
    TelemetryAnomaly = 5,
    CgroupDestroy = 6,
    CapabilityRejected = 7,
}

impl KelEventKind {
    fn decode(value: u8) -> Result<Self, SandboxError> {
        match value {
            1 => Ok(Self::CapabilityValidated),
            2 => Ok(Self::Spawn),
            3 => Ok(Self::WorkerAttested),
            4 => Ok(Self::PolicyGateClear),
            5 => Ok(Self::TelemetryAnomaly),
            6 => Ok(Self::CgroupDestroy),
            7 => Ok(Self::CapabilityRejected),
            _ => Err(SandboxError::Enforcement(
                "KEL record contains an unknown event kind".into(),
            )),
        }
    }
}

/// Fixed-width proof returned by the worker for a supervisor-generated challenge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KelAttestationProof {
    pub nonce: [u8; 32],
    pub worker_public_key: [u8; 32],
    pub worker_signature: [u8; 64],
    pub launcher_pid: u32,
    pub cgroup_id: u64,
    pub manifest_hash: [u8; 32],
    pub capability_hash: [u8; 32],
    pub executable_hash: [u8; 32],
}

impl KelAttestationProof {
    fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    fn payload_hash(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(PROOF_DOMAIN);
        hash.update(self.nonce);
        hash.update(self.worker_public_key);
        hash.update(self.worker_signature);
        hash.update(self.launcher_pid.to_le_bytes());
        hash.update(self.cgroup_id.to_le_bytes());
        hash.update(self.manifest_hash);
        hash.update(self.capability_hash);
        hash.update(self.executable_hash);
        hash.finalize().into()
    }

    /// Hash the exact public lineage tuple recorded by the Spawn event.
    fn spawn_payload_hash(&self) -> [u8; 32] {
        let mut payload = [0u8; 4 + 8 + 32 + 32];
        let mut offset = 0;
        copy_into(&mut payload, &mut offset, &self.launcher_pid.to_le_bytes());
        copy_into(&mut payload, &mut offset, &self.cgroup_id.to_le_bytes());
        copy_into(&mut payload, &mut offset, &self.manifest_hash);
        copy_into(&mut payload, &mut offset, &self.executable_hash);
        hash_payload(&payload)
    }
}

/// Values from the verified manifest and trusted daemon identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KelAttestationIdentity {
    pub session_id: [u8; 16],
    pub cgroup_id: u64,
    pub manifest_hash: [u8; 32],
    pub capability_hash: [u8; 32],
    pub executable_hash: [u8; 32],
    pub daemon_public_key: [u8; 32],
}

/// The challenge travels through the pre-established command SPSC ring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KelAttestationChallenge {
    pub session_id: [u8; 16],
    pub nonce: [u8; 32],
    pub launcher_pid: u32,
    pub cgroup_id: u64,
    pub manifest_hash: [u8; 32],
    pub capability_hash: [u8; 32],
    pub executable_hash: [u8; 32],
    pub daemon_public_key: [u8; 32],
}

impl KelAttestationChallenge {
    pub fn encode_frame(&self, output: &mut [u8; KEL_CHALLENGE_FRAME_LEN]) {
        let mut offset = 0;
        output[offset] = KEL_CHALLENGE_OPCODE;
        offset += 1;
        copy_into(output, &mut offset, &self.session_id);
        copy_into(output, &mut offset, &self.nonce);
        copy_into(output, &mut offset, &self.launcher_pid.to_le_bytes());
        copy_into(output, &mut offset, &self.cgroup_id.to_le_bytes());
        copy_into(output, &mut offset, &self.manifest_hash);
        copy_into(output, &mut offset, &self.capability_hash);
        copy_into(output, &mut offset, &self.executable_hash);
        copy_into(output, &mut offset, &self.daemon_public_key);
        debug_assert_eq!(offset, KEL_CHALLENGE_FRAME_LEN);
    }

    pub fn decode_frame(input: &[u8]) -> Result<Self, SandboxError> {
        if input.len() != KEL_CHALLENGE_FRAME_LEN || input[0] != KEL_CHALLENGE_OPCODE {
            return Err(SandboxError::Enforcement(
                "KEL attestation challenge has an invalid opcode or length".into(),
            ));
        }
        let mut offset = 1;
        let session_id = take_array::<16>(input, &mut offset)?;
        let nonce = take_array::<32>(input, &mut offset)?;
        let launcher_pid = u32::from_le_bytes(take_array::<4>(input, &mut offset)?);
        let cgroup_id = u64::from_le_bytes(take_array::<8>(input, &mut offset)?);
        let manifest_hash = take_array::<32>(input, &mut offset)?;
        let capability_hash = take_array::<32>(input, &mut offset)?;
        let executable_hash = take_array::<32>(input, &mut offset)?;
        let daemon_public_key = take_array::<32>(input, &mut offset)?;
        Ok(Self {
            session_id,
            nonce,
            launcher_pid,
            cgroup_id,
            manifest_hash,
            capability_hash,
            executable_hash,
            daemon_public_key,
        })
    }

    /// A domain-separated digest binds the nonce and all launch identities.
    pub fn digest(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(ATTESTATION_DOMAIN);
        hash.update(self.session_id);
        hash.update(self.nonce);
        hash.update(self.launcher_pid.to_le_bytes());
        hash.update(self.cgroup_id.to_le_bytes());
        hash.update(self.manifest_hash);
        hash.update(self.capability_hash);
        hash.update(self.executable_hash);
        hash.update(self.daemon_public_key);
        hash.finalize().into()
    }

    pub fn verify_worker_response(
        &self,
        response: &[u8],
    ) -> Result<KelAttestationProof, SandboxError> {
        if response.len() != KEL_RESPONSE_FRAME_LEN || response[0] != KEL_RESPONSE_OPCODE {
            return Err(SandboxError::Enforcement(
                "KEL worker attestation response has an invalid opcode or length".into(),
            ));
        }
        let mut worker_public_key = [0; 32];
        worker_public_key.copy_from_slice(&response[1..33]);
        let mut worker_signature = [0; 64];
        worker_signature.copy_from_slice(&response[33..97]);

        let worker_key = VerifyingKey::from_bytes(&worker_public_key).map_err(|_| {
            SandboxError::Enforcement("worker attestation contains an invalid Ed25519 key".into())
        })?;
        let signature = Signature::from_bytes(&worker_signature);
        worker_key
            .verify(&self.digest(), &signature)
            .map_err(|_| {
                SandboxError::Enforcement("worker attestation signature is invalid".into())
            })?;

        Ok(KelAttestationProof {
            nonce: self.nonce,
            worker_public_key,
            worker_signature,
            launcher_pid: self.launcher_pid,
            cgroup_id: self.cgroup_id,
            manifest_hash: self.manifest_hash,
            capability_hash: self.capability_hash,
            executable_hash: self.executable_hash,
        })
    }

    pub fn build_worker_response(
        &self,
        worker_key: &SigningKey,
        response: &mut [u8; KEL_RESPONSE_FRAME_LEN],
    ) {
        response[0] = KEL_RESPONSE_OPCODE;
        response[1..33].copy_from_slice(&worker_key.verifying_key().to_bytes());
        response[33..97].copy_from_slice(&worker_key.sign(&self.digest()).to_bytes());
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KelEvent {
    pub sequence: u64,
    pub timestamp_ns: u64,
    pub kind: KelEventKind,
    pub session_id: [u8; 16],
    pub payload_hash: [u8; 32],
    pub previous_hash: [u8; 32],
    pub event_hash: [u8; 32],
    pub signer_public_key: [u8; 32],
    pub signature: [u8; 64],
    pub attestation: KelAttestationProof,
}

impl KelEvent {
    fn calculate_hash(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(EVENT_DOMAIN);
        hash.update(self.sequence.to_le_bytes());
        hash.update(self.timestamp_ns.to_le_bytes());
        hash.update([self.kind as u8]);
        hash.update(self.session_id);
        hash.update(self.payload_hash);
        hash.update(self.previous_hash);
        hash.update(self.signer_public_key);
        update_proof(&mut hash, &self.attestation);
        hash.finalize().into()
    }

    pub fn verify(
        &self,
        expected_previous_hash: &[u8; 32],
        daemon_key: &VerifyingKey,
    ) -> Result<(), SandboxError> {
        if &self.previous_hash != expected_previous_hash {
            return Err(SandboxError::Enforcement(
                "KEL hash chain references an unexpected predecessor".into(),
            ));
        }
        if self.signer_public_key != daemon_key.to_bytes() {
            return Err(SandboxError::Enforcement(
                "KEL event signer differs from the trusted daemon identity".into(),
            ));
        }
        if self.calculate_hash() != self.event_hash {
            return Err(SandboxError::Enforcement(
                "KEL event hash does not match its canonical fields".into(),
            ));
        }
        let signature = Signature::from_bytes(&self.signature);
        daemon_key.verify(&self.event_hash, &signature).map_err(|_| {
            SandboxError::Enforcement("KEL daemon event signature is invalid".into())
        })?;

        if self.kind == KelEventKind::WorkerAttested {
            if self.attestation.is_empty()
                || self.attestation.launcher_pid == 0
                || self.attestation.cgroup_id == 0
            {
                return Err(SandboxError::Enforcement(
                    "KEL worker attestation proof is incomplete".into(),
                ));
            }
            if self.payload_hash != self.attestation.payload_hash() {
                return Err(SandboxError::Enforcement(
                    "KEL worker attestation payload hash is invalid".into(),
                ));
            }
            let challenge = KelAttestationChallenge {
                session_id: self.session_id,
                nonce: self.attestation.nonce,
                launcher_pid: self.attestation.launcher_pid,
                cgroup_id: self.attestation.cgroup_id,
                manifest_hash: self.attestation.manifest_hash,
                capability_hash: self.attestation.capability_hash,
                executable_hash: self.attestation.executable_hash,
                daemon_public_key: self.signer_public_key,
            };
            let worker_key = VerifyingKey::from_bytes(&self.attestation.worker_public_key)
                .map_err(|_| {
                    SandboxError::Enforcement("KEL worker public key is invalid".into())
                })?;
            worker_key
                .verify(
                    &challenge.digest(),
                    &Signature::from_bytes(&self.attestation.worker_signature),
                )
                .map_err(|_| {
                    SandboxError::Enforcement(
                        "KEL worker challenge-response proof is invalid".into(),
                    )
                })?;
        } else if !self.attestation.is_empty() {
            return Err(SandboxError::Enforcement(
                "non-attestation KEL event contains an unexpected worker proof".into(),
            ));
        }
        Ok(())
    }

    fn encode(&self, output: &mut [u8; KEL_EVENT_ENCODED_LEN]) {
        let mut offset = 0;
        copy_into(output, &mut offset, &self.sequence.to_le_bytes());
        copy_into(output, &mut offset, &self.timestamp_ns.to_le_bytes());
        copy_into(output, &mut offset, &[self.kind as u8]);
        copy_into(output, &mut offset, &self.session_id);
        copy_into(output, &mut offset, &self.payload_hash);
        copy_into(output, &mut offset, &self.previous_hash);
        copy_into(output, &mut offset, &self.event_hash);
        copy_into(output, &mut offset, &self.signer_public_key);
        copy_into(output, &mut offset, &self.signature);
        encode_proof(&self.attestation, output, &mut offset);
        debug_assert_eq!(offset, KEL_EVENT_ENCODED_LEN);
    }

    fn decode(input: &[u8; KEL_EVENT_ENCODED_LEN]) -> Result<Self, SandboxError> {
        let mut offset = 0;
        let sequence = u64::from_le_bytes(take_array::<8>(input, &mut offset)?);
        let timestamp_ns = u64::from_le_bytes(take_array::<8>(input, &mut offset)?);
        let kind = KelEventKind::decode(take_array::<1>(input, &mut offset)?[0])?;
        let session_id = take_array::<16>(input, &mut offset)?;
        let payload_hash = take_array::<32>(input, &mut offset)?;
        let previous_hash = take_array::<32>(input, &mut offset)?;
        let event_hash = take_array::<32>(input, &mut offset)?;
        let signer_public_key = take_array::<32>(input, &mut offset)?;
        let signature = take_array::<64>(input, &mut offset)?;
        let attestation = decode_proof(input, &mut offset)?;
        if offset != KEL_EVENT_ENCODED_LEN {
            return Err(SandboxError::Enforcement(
                "KEL record decoder did not consume the fixed record".into(),
            ));
        }
        Ok(Self {
            sequence,
            timestamp_ns,
            kind,
            session_id,
            payload_hash,
            previous_hash,
            event_hash,
            signer_public_key,
            signature,
            attestation,
        })
    }
}

pub type SharedKelJournal = Arc<Mutex<KelJournal>>;

/// A single-writer journal. Records are fixed width; no record overwrites an
/// older record, and the writer's root advances only after sync_data succeeds.
pub struct KelJournal {
    file: File,
    signing_key: SigningKey,
    session_id: [u8; 16],
    next_sequence: u64,
    previous_hash: [u8; 32],
    last_kind: Option<KelEventKind>,
    last_payload_hash: Option<[u8; 32]>,
    validated_capability_hash: Option<[u8; 32]>,
    destroyed: bool,
    poisoned: bool,
}

impl KelJournal {
    pub fn create(
        path: impl AsRef<Path>,
        signing_key: &SigningKey,
        session_id: [u8; 16],
    ) -> Result<Self, SandboxError> {
        let mut options = OpenOptions::new();
        options.create_new(true).append(true).read(true);
        #[cfg(unix)]
        options.mode(0o600);
        #[cfg(target_os = "linux")]
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        let file = options.open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() != 0 {
            return Err(SandboxError::Enforcement(
                "new KEL journal is not an empty regular file".into(),
            ));
        }
        Ok(Self {
            file,
            signing_key: signing_key.clone(),
            session_id,
            next_sequence: 0,
            previous_hash: ZERO_HASH,
            last_kind: None,
            last_payload_hash: None,
            validated_capability_hash: None,
            destroyed: false,
            poisoned: false,
        })
    }

    pub fn shared(self) -> SharedKelJournal {
        Arc::new(Mutex::new(self))
    }

    pub fn session_id(&self) -> [u8; 16] {
        self.session_id
    }

    pub fn head_root(&self) -> [u8; 32] {
        self.previous_hash
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence
    }

    pub fn head_snapshot(&self) -> KelHeadSnapshot {
        KelHeadSnapshot {
            session_id: self.session_id,
            next_sequence: self.next_sequence,
            head_root: self.previous_hash,
        }
    }

    /// Re-verify the persisted prefix against the in-memory head without
    /// allocating. The supervisor/telemetry thread calls this to detect
    /// concurrent on-disk mutation while the worker is alive.
    pub fn verify_disk_state(&mut self) -> Result<(), SandboxError> {
        use std::io::{Seek, SeekFrom};

        let metadata = self.file.metadata()?;
        let file_len = metadata.len();
        if !metadata.is_file() || file_len % KEL_EVENT_ENCODED_LEN as u64 != 0 {
            return Err(SandboxError::Enforcement(
                "KEL file contains a partial record or is not a regular file".into(),
            ));
        }

        self.file.seek(SeekFrom::Start(0))?;
        let mut previous_hash = ZERO_HASH;
        let mut previous_kind = None;
        let mut previous_payload_hash = None;
        let mut validated_capability_hash = None;
        let mut expected_sequence = 0_u64;
        let record_count = file_len / KEL_EVENT_ENCODED_LEN as u64;
        for _ in 0..record_count {
            let mut record = [0; KEL_EVENT_ENCODED_LEN];
            self.file.read_exact(&mut record)?;
            let event = KelEvent::decode(&record)?;
            if event.sequence != expected_sequence
                || event.session_id != self.session_id
                || !transition_allowed(previous_kind, event.kind)
            {
                return Err(SandboxError::Enforcement(
                    "KEL persisted lifecycle state or sequence is inconsistent".into(),
                ));
            }
            if event.kind == KelEventKind::WorkerAttested
                && (validated_capability_hash != Some(event.attestation.capability_hash)
                    || previous_payload_hash != Some(event.attestation.spawn_payload_hash()))
            {
                return Err(SandboxError::Enforcement(
                    "KEL worker proof does not match the signed capability/Spawn records".into(),
                ));
            }
            event.verify(&previous_hash, &self.signing_key.verifying_key())?;
            if event.kind == KelEventKind::CapabilityValidated {
                validated_capability_hash = Some(event.payload_hash);
            }
            previous_hash = event.event_hash;
            previous_kind = Some(event.kind);
            previous_payload_hash = Some(event.payload_hash);
            expected_sequence = expected_sequence.checked_add(1).ok_or_else(|| {
                SandboxError::Enforcement("KEL verification sequence overflow".into())
            })?;
        }
        if self.file.metadata()?.len() != file_len
            || expected_sequence != self.next_sequence
            || previous_hash != self.previous_hash
            || previous_payload_hash != self.last_payload_hash
            || validated_capability_hash != self.validated_capability_hash
            || (previous_kind == Some(KelEventKind::CgroupDestroy)) != self.destroyed
        {
            return Err(SandboxError::Enforcement(
                "KEL persisted head differs from the trusted in-memory root".into(),
            ));
        }
        self.file.seek(SeekFrom::End(0))?;
        Ok(())
    }

    pub fn append(
        &mut self,
        kind: KelEventKind,
        payload_hash: [u8; 32],
    ) -> Result<KelEvent, SandboxError> {
        if matches!(kind, KelEventKind::WorkerAttested | KelEventKind::CgroupDestroy) {
            return Err(SandboxError::Enforcement(
                "KEL attestation and destruction events require their dedicated append APIs".into(),
            ));
        }
        self.append_with_proof(kind, payload_hash, KelAttestationProof::default())
    }

    pub fn append_attestation(
        &mut self,
        proof: KelAttestationProof,
    ) -> Result<KelEvent, SandboxError> {
        if proof.is_empty() {
            return Err(SandboxError::Enforcement(
                "cannot append an empty worker attestation".into(),
            ));
        }
        self.append_with_proof(KelEventKind::WorkerAttested, proof.payload_hash(), proof)
    }

    pub fn record_cgroup_destroyed(
        &mut self,
        payload_hash: [u8; 32],
    ) -> Result<Option<KelEvent>, SandboxError> {
        if self.destroyed {
            return Ok(None);
        }
        let event = self.append_with_proof(
            KelEventKind::CgroupDestroy,
            payload_hash,
            KelAttestationProof::default(),
        )?;
        self.destroyed = true;
        Ok(Some(event))
    }

    fn append_with_proof(
        &mut self,
        kind: KelEventKind,
        payload_hash: [u8; 32],
        attestation: KelAttestationProof,
    ) -> Result<KelEvent, SandboxError> {
        if self.poisoned {
            return Err(SandboxError::Enforcement(
                "KEL journal is poisoned after an earlier persistence failure".into(),
            ));
        }
        if self.destroyed {
            return Err(SandboxError::Enforcement(
                "KEL journal cannot append after cgroup destruction".into(),
            ));
        }
        if !transition_allowed(self.last_kind, kind) {
            return Err(SandboxError::Enforcement(format!(
                "invalid KEL lifecycle transition from {:?} to {kind:?}",
                self.last_kind
            )));
        }
        if kind == KelEventKind::WorkerAttested
            && (self.validated_capability_hash != Some(attestation.capability_hash)
                || self.last_payload_hash != Some(attestation.spawn_payload_hash()))
        {
            return Err(SandboxError::Enforcement(
                "KEL worker proof does not match the previously signed capability and Spawn lineage".into(),
            ));
        }
        if (kind == KelEventKind::WorkerAttested) != !attestation.is_empty() {
            return Err(SandboxError::Enforcement(
                "KEL worker proof does not match its event kind".into(),
            ));
        }
        if let Err(error) = self.verify_disk_state() {
            self.poisoned = true;
            return Err(SandboxError::Enforcement(format!(
                "KEL on-disk integrity verification failed: {error}"
            )));
        }
        let mut event = KelEvent {
            sequence: self.next_sequence,
            timestamp_ns: unix_time_ns()?,
            kind,
            session_id: self.session_id,
            payload_hash,
            previous_hash: self.previous_hash,
            event_hash: ZERO_HASH,
            signer_public_key: self.signing_key.verifying_key().to_bytes(),
            signature: [0; 64],
            attestation,
        };
        event.event_hash = event.calculate_hash();
        event.signature = self.signing_key.sign(&event.event_hash).to_bytes();
        event.verify(&self.previous_hash, &self.signing_key.verifying_key())?;

        let mut encoded = [0; KEL_EVENT_ENCODED_LEN];
        event.encode(&mut encoded);
        if let Err(error) = self.file.write_all(&encoded).and_then(|()| self.file.sync_data()) {
            self.poisoned = true;
            return Err(SandboxError::Enforcement(format!(
                "KEL append was not durably committed: {error}"
            )));
        }

        self.previous_hash = event.event_hash;
        self.last_kind = Some(event.kind);
        self.last_payload_hash = Some(event.payload_hash);
        if event.kind == KelEventKind::CapabilityValidated {
            self.validated_capability_hash = Some(event.payload_hash);
        }
        self.next_sequence = self.next_sequence.checked_add(1).ok_or_else(|| {
            self.poisoned = true;
            SandboxError::Enforcement("KEL event sequence overflow".into())
        })?;
        Ok(event)
    }

    /// Verify a persisted chain. Supplying an independently stored expected root
    /// also detects truncation or rollback of the journal's final records.
    pub fn verify_file(
        path: impl AsRef<Path>,
        trusted_daemon_key: &VerifyingKey,
        expected_head: Option<[u8; 32]>,
    ) -> Result<KelVerification, SandboxError> {
        let mut file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() % KEL_EVENT_ENCODED_LEN as u64 != 0 {
            return Err(SandboxError::Enforcement(
                "KEL journal is not a sequence of complete fixed-width records".into(),
            ));
        }

        let mut events: Vec<KelEvent> = Vec::new();
        let mut previous_hash = ZERO_HASH;
        let mut previous_kind = None;
        let mut previous_payload_hash = None;
        let mut validated_capability_hash = None;
        let mut expected_sequence = 0_u64;
        loop {
            let mut record = [0; KEL_EVENT_ENCODED_LEN];
            match file.read_exact(&mut record) {
                Ok(()) => {
                    let event = KelEvent::decode(&record)?;
                    if !transition_allowed(previous_kind, event.kind) {
                        return Err(SandboxError::Enforcement(format!(
                            "KEL lifecycle transition from {previous_kind:?} to {:?} is invalid",
                            event.kind
                        )));
                    }
                    if event.sequence != expected_sequence {
                        return Err(SandboxError::Enforcement(
                            "KEL sequence number is missing, duplicated, or reordered".into(),
                        ));
                    }
                    if event.kind == KelEventKind::WorkerAttested
                        && (validated_capability_hash != Some(event.attestation.capability_hash)
                            || previous_payload_hash != Some(event.attestation.spawn_payload_hash()))
                    {
                        return Err(SandboxError::Enforcement(
                            "KEL worker proof does not match the signed capability/Spawn records".into(),
                        ));
                    }
                    event.verify(&previous_hash, trusted_daemon_key)?;
                    if let Some(last) = events.last() {
                        if last.session_id != event.session_id {
                            return Err(SandboxError::Enforcement(
                                "KEL journal mixed multiple worker sessions".into(),
                            ));
                        }
                    }
                    if event.kind == KelEventKind::CgroupDestroy
                        && expected_sequence + 1
                            != metadata.len() / KEL_EVENT_ENCODED_LEN as u64
                    {
                        return Err(SandboxError::Enforcement(
                            "KEL journal contains events after cgroup destruction".into(),
                        ));
                    }
                    if event.kind == KelEventKind::CapabilityValidated {
                        validated_capability_hash = Some(event.payload_hash);
                    }
                    previous_hash = event.event_hash;
                    previous_kind = Some(event.kind);
                    previous_payload_hash = Some(event.payload_hash);
                    expected_sequence = expected_sequence.checked_add(1).ok_or_else(|| {
                        SandboxError::Enforcement("KEL verification sequence overflow".into())
                    })?;
                    events.push(event);
                }
                Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(error) => return Err(SandboxError::Io(error)),
            }
        }
        if file.metadata()?.len() != metadata.len()
            || expected_sequence != metadata.len() / KEL_EVENT_ENCODED_LEN as u64
        {
            return Err(SandboxError::Enforcement(
                "KEL journal changed or lost records during verification".into(),
            ));
        }
        if let Some(expected) = expected_head {
            if previous_hash != expected {
                return Err(SandboxError::Enforcement(
                    "KEL final root differs from the independently anchored root".into(),
                ));
            }
        }
        Ok(KelVerification {
            events,
            head_root: previous_hash,
        })
    }
}

/// State root suitable for storing in a separate trusted head-anchor service.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KelHeadSnapshot {
    pub session_id: [u8; 16],
    pub next_sequence: u64,
    pub head_root: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KelVerification {
    pub events: Vec<KelEvent>,
    pub head_root: [u8; 32],
}

fn transition_allowed(previous: Option<KelEventKind>, next: KelEventKind) -> bool {
    match previous {
        None => matches!(
            next,
            KelEventKind::CapabilityValidated | KelEventKind::CapabilityRejected
        ),
        Some(KelEventKind::CapabilityValidated) => {
            matches!(next, KelEventKind::Spawn | KelEventKind::CgroupDestroy)
        }
        Some(KelEventKind::Spawn) => matches!(
            next,
            KelEventKind::WorkerAttested
                | KelEventKind::TelemetryAnomaly
                | KelEventKind::CgroupDestroy
        ),
        Some(KelEventKind::WorkerAttested) => {
            matches!(next, KelEventKind::PolicyGateClear | KelEventKind::CgroupDestroy)
        }
        Some(KelEventKind::PolicyGateClear) => {
            matches!(next, KelEventKind::TelemetryAnomaly | KelEventKind::CgroupDestroy)
        }
        Some(KelEventKind::TelemetryAnomaly) => {
            matches!(next, KelEventKind::TelemetryAnomaly | KelEventKind::CgroupDestroy)
        }
        Some(KelEventKind::CapabilityRejected | KelEventKind::CgroupDestroy) => false,
    }
}

pub fn hash_payload(payload: &[u8]) -> [u8; 32] {
    Sha256::digest(payload).into()
}

pub fn hash_serializable<T: serde::Serialize>(value: &T) -> Result<[u8; 32], SandboxError> {
    let bytes = serde_json::to_vec(value)?;
    Ok(hash_payload(&bytes))
}

pub fn parse_sha256_hex(value: &str) -> Result<[u8; 32], SandboxError> {
    if value.len() != 64 {
        return Err(SandboxError::InvalidConfig(
            "SHA-256 hex identity must contain exactly 64 characters".into(),
        ));
    }
    let bytes = value.as_bytes();
    let mut output = [0; 32];
    for (index, pair) in bytes.chunks_exact(2).enumerate() {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        output[index] = (high << 4) | low;
    }
    Ok(output)
}

fn hex_nibble(value: u8) -> Result<u8, SandboxError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(SandboxError::InvalidConfig(
            "SHA-256 identity contains a non-hexadecimal character".into(),
        )),
    }
}

pub fn session_id_from_token_id(token_id: &str) -> [u8; 16] {
    let mut hash = Sha256::new();
    hash.update(SESSION_DOMAIN);
    hash.update(token_id.as_bytes());
    let digest: [u8; 32] = hash.finalize().into();
    let mut session_id = [0; 16];
    session_id.copy_from_slice(&digest[..16]);
    session_id
}

pub fn unix_time_ns() -> Result<u64, SandboxError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SandboxError::Enforcement("system clock precedes Unix epoch".into()))?
        .as_nanos();
    Ok(nanos.min(u64::MAX as u128) as u64)
}

fn update_proof(hash: &mut Sha256, proof: &KelAttestationProof) {
    hash.update(proof.nonce);
    hash.update(proof.worker_public_key);
    hash.update(proof.worker_signature);
    hash.update(proof.launcher_pid.to_le_bytes());
    hash.update(proof.cgroup_id.to_le_bytes());
    hash.update(proof.manifest_hash);
    hash.update(proof.capability_hash);
    hash.update(proof.executable_hash);
}

fn encode_proof(
    proof: &KelAttestationProof,
    output: &mut [u8; KEL_EVENT_ENCODED_LEN],
    offset: &mut usize,
) {
    copy_into(output, offset, &proof.nonce);
    copy_into(output, offset, &proof.worker_public_key);
    copy_into(output, offset, &proof.worker_signature);
    copy_into(output, offset, &proof.launcher_pid.to_le_bytes());
    copy_into(output, offset, &proof.cgroup_id.to_le_bytes());
    copy_into(output, offset, &proof.manifest_hash);
    copy_into(output, offset, &proof.capability_hash);
    copy_into(output, offset, &proof.executable_hash);
}

fn decode_proof(
    input: &[u8; KEL_EVENT_ENCODED_LEN],
    offset: &mut usize,
) -> Result<KelAttestationProof, SandboxError> {
    Ok(KelAttestationProof {
        nonce: take_array::<32>(input, offset)?,
        worker_public_key: take_array::<32>(input, offset)?,
        worker_signature: take_array::<64>(input, offset)?,
        launcher_pid: u32::from_le_bytes(take_array::<4>(input, offset)?),
        cgroup_id: u64::from_le_bytes(take_array::<8>(input, offset)?),
        manifest_hash: take_array::<32>(input, offset)?,
        capability_hash: take_array::<32>(input, offset)?,
        executable_hash: take_array::<32>(input, offset)?,
    })
}

fn copy_into<const N: usize>(output: &mut [u8; N], offset: &mut usize, bytes: &[u8]) {
    output[*offset..*offset + bytes.len()].copy_from_slice(bytes);
    *offset += bytes.len();
}

fn take_array<const N: usize>(
    input: &[u8],
    offset: &mut usize,
) -> Result<[u8; N], SandboxError> {
    let end = offset.checked_add(N).ok_or_else(|| {
        SandboxError::Enforcement("KEL frame offset overflow".into())
    })?;
    let bytes = input.get(*offset..end).ok_or_else(|| {
        SandboxError::Enforcement("KEL frame is shorter than its fixed schema".into())
    })?;
    let mut output = [0; N];
    output.copy_from_slice(bytes);
    *offset = end;
    Ok(output)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom};

    fn test_challenge(key: &SigningKey) -> KelAttestationChallenge {
        KelAttestationChallenge {
            session_id: session_id_from_token_id("test-token"),
            nonce: [0xA5; 32],
            launcher_pid: 1234,
            cgroup_id: 5678,
            manifest_hash: [1; 32],
            capability_hash: [2; 32],
            executable_hash: [3; 32],
            daemon_public_key: key.verifying_key().to_bytes(),
        }
    }

    #[test]
    fn fixed_ring_challenge_round_trips_and_response_binds_launch_lineage() {
        let daemon = SigningKey::from_bytes(&[7; 32]);
        let worker = SigningKey::from_bytes(&[9; 32]);
        let challenge = test_challenge(&daemon);
        let mut frame = [0; KEL_CHALLENGE_FRAME_LEN];
        challenge.encode_frame(&mut frame);
        let decoded = KelAttestationChallenge::decode_frame(&frame).expect("decode challenge");
        assert_eq!(decoded, challenge);

        let mut response = [0; KEL_RESPONSE_FRAME_LEN];
        decoded.build_worker_response(&worker, &mut response);
        let proof = decoded.verify_worker_response(&response).expect("verify proof");
        assert_eq!(proof.worker_public_key, worker.verifying_key().to_bytes());

        let mut altered = challenge;
        altered.cgroup_id += 1;
        assert!(altered.verify_worker_response(&response).is_err());
    }

    #[test]
    fn journal_verifies_chain_and_worker_dual_signature_then_rejects_mutation() {
        let root = tempfile::tempdir().expect("temp KEL dir");
        let path = root.path().join("worker.kel");
        let daemon = SigningKey::from_bytes(&[7; 32]);
        let challenge = test_challenge(&daemon);
        let worker = SigningKey::from_bytes(&[9; 32]);
        let mut response = [0; KEL_RESPONSE_FRAME_LEN];
        challenge.build_worker_response(&worker, &mut response);
        let proof = challenge.verify_worker_response(&response).expect("valid proof");

        let mut journal = KelJournal::create(&path, &daemon, challenge.session_id)
            .expect("create append-only journal");
        journal
            .append(
                KelEventKind::CapabilityValidated,
                challenge.capability_hash,
            )
            .expect("append capability event");

        let mut spawn_payload = [0u8; 4 + 8 + 32 + 32];
        let mut spawn_offset = 0;
        copy_into(
            &mut spawn_payload,
            &mut spawn_offset,
            &challenge.launcher_pid.to_le_bytes(),
        );
        copy_into(
            &mut spawn_payload,
            &mut spawn_offset,
            &challenge.cgroup_id.to_le_bytes(),
        );
        copy_into(&mut spawn_payload, &mut spawn_offset, &challenge.manifest_hash);
        copy_into(&mut spawn_payload, &mut spawn_offset, &challenge.executable_hash);
        journal
            .append(KelEventKind::Spawn, hash_payload(&spawn_payload))
            .expect("append spawn event");
        journal.append_attestation(proof).expect("append dual-signed proof");
        journal
            .append(KelEventKind::PolicyGateClear, challenge.digest())
            .expect("append policy gate event");
        let head = journal.head_root();
        drop(journal);

        let verified = KelJournal::verify_file(&path, &daemon.verifying_key(), Some(head))
            .expect("verify all journal records");
        assert_eq!(verified.events.len(), 4);
        assert_eq!(verified.head_root, head);

        let mut file = OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open tamper fixture");
        file.seek(SeekFrom::Start(32)).expect("seek record field");
        file.write_all(&[0xFF]).expect("mutate journal");
        file.sync_all().expect("persist tamper fixture");
        assert!(KelJournal::verify_file(&path, &daemon.verifying_key(), Some(head)).is_err());
    }

    #[test]
    fn journal_never_overwrites_existing_session_and_destroy_is_terminal() {
        let root = tempfile::tempdir().expect("temp KEL dir");
        let path = root.path().join("worker.kel");
        let daemon = SigningKey::from_bytes(&[8; 32]);
        let mut journal = KelJournal::create(&path, &daemon, [4; 16]).expect("create journal");
        assert!(KelJournal::create(&path, &daemon, [4; 16]).is_err());
        journal
            .append(KelEventKind::CapabilityValidated, hash_payload(b"capability"))
            .expect("append validated capability event");
        journal
            .record_cgroup_destroyed(hash_payload(b"destroyed"))
            .expect("append terminal event");
        assert!(journal.append(KelEventKind::TelemetryAnomaly, hash_payload(b"late")).is_err());
        assert!(journal
            .record_cgroup_destroyed(hash_payload(b"repeat"))
            .expect("idempotent destroy")
            .is_none());
    }
}
