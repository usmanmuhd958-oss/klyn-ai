//! Authenticated, length-prefixed Unix-domain-socket RPC for KEL v1.
//!
//! Wire framing: 4-byte unsigned big-endian body length followed by exactly that many
//! UTF-8 JSON bytes. Frames are capped at 1 MiB. Every request carries a 256-bit
//! hex token; socket permissions are 0600. Never expose this socket outside a protected
//! local service boundary or reuse the token across trust domains.

use crate::{EvidenceStore, LedgerError};
use klyn_evidence::DsseEnvelopeV1;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{self, Read, Write},
    os::unix::{fs::{FileTypeExt, PermissionsExt}, net::{UnixListener, UnixStream}},
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 1_048_576;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RpcRequestV1 {
    version: u32,
    id: String,
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcResponseV1 {
    version: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcErrorV1>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcErrorV1 {
    code: &'static str,
    message: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppendEvidenceParamsV1 {
    envelope: DsseEnvelopeV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProofParamsV1 {
    evidence_id: String,
}

fn response_error(id: &str, code: &'static str, message: &'static str) -> RpcResponseV1 {
    RpcResponseV1 {
        version: PROTOCOL_VERSION,
        id: id.to_owned(),
        result: None,
        error: Some(RpcErrorV1 { code, message }),
    }
}

fn response_ok(id: &str, result: Value) -> RpcResponseV1 {
    RpcResponseV1 {
        version: PROTOCOL_VERSION,
        id: id.to_owned(),
        result: Some(result),
        error: None,
    }
}

/// Compare the complete token without early exit on individual bytes.
fn token_matches(expected: &[u8], candidate: &[u8]) -> bool {
    let max_len = expected.len().max(candidate.len());
    let mut difference = expected.len() ^ candidate.len();
    for index in 0..max_len {
        difference |= usize::from(
            expected.get(index).copied().unwrap_or(0)
                ^ candidate.get(index).copied().unwrap_or(0),
        );
    }
    difference == 0
}

fn now_epoch_ms() -> Result<u64, &'static str> {
    let duration = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock precedes UNIX epoch")?;
    u64::try_from(duration.as_millis()).map_err(|_| "system clock timestamp overflow")
}

fn read_frame(stream: &mut UnixStream) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    match stream.read(&mut header[..1])? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!("read was limited to one byte"),
    }
    stream.read_exact(&mut header[1..])?;
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "invalid frame length"));
    }
    let mut body = vec![0; length];
    stream.read_exact(&mut body)?;
    Ok(Some(body))
}

fn write_frame(stream: &mut UnixStream, response: &RpcResponseV1) -> io::Result<()> {
    let body = serde_json::to_vec(response)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if body.is_empty() || body.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "response exceeds frame limit"));
    }
    let length = u32::try_from(body.len())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    stream.write_all(&length.to_be_bytes())?;
    stream.write_all(&body)?;
    stream.flush()
}

fn dispatch(request: &RpcRequestV1, token: &[u8], store: &Arc<Mutex<EvidenceStore>>) -> RpcResponseV1 {
    if request.id.is_empty() || request.id.len() > 128 ||
        !request.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.') {
        return response_error(&request.id, "invalid_request_id", "request id must be 1-128 safe ASCII characters");
    }
    if request.version != PROTOCOL_VERSION {
        return response_error(&request.id, "unsupported_version", "unsupported KEL RPC protocol version");
    }
    if !token_matches(token, request.token.as_bytes()) {
        return response_error(&request.id, "unauthenticated", "authentication failed");
    }

    match request.method.as_str() {
        "ledger.health" => {
            let guard = match store.lock() {
                Ok(guard) => guard,
                Err(_) => return response_error(&request.id, "internal_error", "ledger lock unavailable"),
            };
            match guard.health_snapshot().and_then(|health| {
                serde_json::to_value(health).map_err(LedgerError::from)
            }) {
                Ok(value) => response_ok(&request.id, value),
                Err(_) => response_error(&request.id, "ledger_unavailable", "ledger health check failed"),
            }
        }
        "evidence.append" => {
            let params: AppendEvidenceParamsV1 = match serde_json::from_value(request.params.clone()) {
                Ok(params) => params,
                Err(_) => return response_error(&request.id, "invalid_params", "append requires exactly an envelope"),
            };
            let now = match now_epoch_ms() {
                Ok(now) => now,
                Err(_) => return response_error(&request.id, "clock_error", "trusted clock is unavailable"),
            };
            let mut guard = match store.lock() {
                Ok(guard) => guard,
                Err(_) => return response_error(&request.id, "internal_error", "ledger lock unavailable"),
            };
            match guard.append(&params.envelope, now, now)
                .and_then(|receipt| serde_json::to_value(receipt).map_err(LedgerError::from)) {
                Ok(value) => response_ok(&request.id, value),
                Err(LedgerError::IdempotencyConflict(_)) =>
                    response_error(&request.id, "idempotency_conflict", "evidence id already exists with different content"),
                Err(LedgerError::LedgerMismatch) =>
                    response_error(&request.id, "ledger_mismatch", "evidence targets a different ledger"),
                Err(LedgerError::Protocol(_)) =>
                    response_error(&request.id, "invalid_evidence", "evidence schema, payload, or signature rejected"),
                Err(_) => response_error(&request.id, "ledger_unavailable", "evidence append failed"),
            }
        }
        "proof.get" => {
            let params: ProofParamsV1 = match serde_json::from_value::<ProofParamsV1>(request.params.clone()) {
                Ok(params) if !params.evidence_id.trim().is_empty() && params.evidence_id.len() <= 256 => params,
                _ => return response_error(&request.id, "invalid_params", "proof.get requires a non-empty evidenceId"),
            };
            let guard = match store.lock() {
                Ok(guard) => guard,
                Err(_) => return response_error(&request.id, "internal_error", "ledger lock unavailable"),
            };
            match guard.evidence_proof(&params.evidence_id)
                .and_then(|proof| serde_json::to_value(proof).map_err(LedgerError::from)) {
                Ok(value) => response_ok(&request.id, value),
                Err(LedgerError::Database(rusqlite::Error::QueryReturnedNoRows)) =>
                    response_error(&request.id, "not_found", "evidence id is not present in this ledger"),
                Err(_) => response_error(&request.id, "proof_unavailable", "proof retrieval failed"),
            }
        }
        _ => response_error(&request.id, "method_not_found", "unknown KEL RPC method"),
    }
}

fn handle_connection(mut stream: UnixStream, token: Arc<Vec<u8>>, store: Arc<Mutex<EvidenceStore>>) {
    loop {
        let frame = match read_frame(&mut stream) {
            Ok(Some(frame)) => frame,
            Ok(None) => return,
            Err(_) => return,
        };
        let request: RpcRequestV1 = match serde_json::from_slice(&frame) {
            Ok(request) => request,
            Err(_) => return, // malformed JSON or unknown fields terminate the connection
        };
        let response = dispatch(&request, &token, &store);
        if write_frame(&mut stream, &response).is_err() {
            return;
        }
    }
}

/// Start the service. The caller owns lifecycle/shutdown (normally the process supervisor).
pub fn serve(socket_path: impl AsRef<Path>, auth_token_hex: String, store: EvidenceStore) -> io::Result<()> {
    if auth_token_hex.len() != 64 || !auth_token_hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "KEL RPC token must be 32 bytes of hex"));
    }
    let socket_path = socket_path.as_ref();
    if let Some(parent) = socket_path.parent() {
        fs::create_dir_all(parent)?;
    }

    match fs::symlink_metadata(socket_path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists, "refusing to remove a non-socket path"));
            }
            match UnixStream::connect(socket_path) {
                Ok(_) => return Err(io::Error::new(io::ErrorKind::AddrInUse, "KEL socket already has a listener")),
                Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => fs::remove_file(socket_path)?,
                Err(error) => return Err(error),
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let listener = UnixListener::bind(socket_path)?;
    fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    let token = Arc::new(auth_token_hex.into_bytes());
    let store = Arc::new(Mutex::new(store));

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let token = Arc::clone(&token);
                let store = Arc::clone(&store);
                thread::Builder::new()
                    .name("kel-rpc-client".into())
                    .spawn(move || handle_connection(stream, token, store))?;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod framing_tests {
    use super::*;

    #[test]
    fn token_comparison_requires_equal_length_and_content() {
        assert!(token_matches(b"012345", b"012345"));
        assert!(!token_matches(b"012345", b"012346"));
        assert!(!token_matches(b"012345", b"01234"));
    }

    #[test]
    fn frame_reader_rejects_zero_and_oversized_frames() {
        use std::os::unix::net::UnixStream;
        let (mut writer, mut reader) = UnixStream::pair().expect("socket pair");
        writer.write_all(&0u32.to_be_bytes()).expect("write empty frame");
        assert_eq!(read_frame(&mut reader).unwrap_err().kind(), io::ErrorKind::InvalidData);

        let (mut writer, mut reader) = UnixStream::pair().expect("socket pair");
        writer.write_all(&((MAX_FRAME_BYTES as u32) + 1).to_be_bytes()).expect("write large frame");
        assert_eq!(read_frame(&mut reader).unwrap_err().kind(), io::ErrorKind::InvalidData);
    }
}
