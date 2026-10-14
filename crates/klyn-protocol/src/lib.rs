//! Versioned, bounded IPC contract shared by KLYN OS processes.
//!
//! The wire format is one JSON object followed by exactly one newline per
//! Unix-domain-socket connection. Unknown fields and methods are rejected.
//! Every executable method must be authorized by klyn-daemon before dispatch.

use std::io::{BufRead, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_EXECUTION_TASK_BYTES: usize = 16 * 1024;
pub const MAX_EXECUTION_RESULT_BYTES: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Ping,
    DaemonStatus,
    DaemonShutdown,
    FsBegin,
    FsWriteFile,
    FsStage,
    FsValidate,
    FsCommit,
    FsAbort,
    /// Submit a bounded typed task to the fixed sandbox worker.
    ExecuteTask,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u16,
    /// Positive, client-generated request correlation identifier.
    pub request_id: u64,
    pub method: Method,
    pub params: Value,
}

impl Request {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion {
                received: self.protocol_version,
                expected: PROTOCOL_VERSION,
            });
        }

        if self.request_id == 0 {
            return Err(ProtocolError::InvalidRequestId);
        }

        match self.method {
            Method::Ping | Method::DaemonStatus | Method::FsBegin => {
                serde_json::from_value::<EmptyParams>(self.params.clone())
                    .map_err(|_| ProtocolError::InvalidParams)?;
            }
            Method::DaemonShutdown => {
                let params: ShutdownParams = serde_json::from_value(self.params.clone())
                    .map_err(|_| ProtocolError::InvalidParams)?;
                if params.reason.as_ref().is_some_and(|reason| {
                    reason.len() > 256 || reason.chars().any(char::is_control)
                }) {
                    return Err(ProtocolError::InvalidParams);
                }
            }
            Method::ExecuteTask => {
                let params: ExecuteTaskParams = serde_json::from_value(self.params.clone())
                    .map_err(|_| ProtocolError::InvalidParams)?;
                params.validate()?;
            }
            Method::FsWriteFile => {
                let object = self
                    .params
                    .as_object()
                    .ok_or(ProtocolError::InvalidParams)?;
                if !object.contains_key("expected_old_content") {
                    return Err(ProtocolError::InvalidParams);
                }
                let params: FsWriteFileParams = serde_json::from_value(self.params.clone())
                    .map_err(|_| ProtocolError::InvalidParams)?;
                if params.transaction_id.is_empty()
                    || params.transaction_id.len() > 96
                    || params.path.is_empty()
                    || params.path.len() > 4096
                    || params.content.len() > 48 * 1024
                    || params
                        .expected_old_content
                        .as_ref()
                        .is_some_and(|old| old.len() > 48 * 1024)
                {
                    return Err(ProtocolError::InvalidParams);
                }
            }
            Method::FsStage | Method::FsValidate | Method::FsCommit | Method::FsAbort => {
                let params: TransactionIdParams = serde_json::from_value(self.params.clone())
                    .map_err(|_| ProtocolError::InvalidParams)?;
                if params.transaction_id.is_empty() || params.transaction_id.len() > 96 {
                    return Err(ProtocolError::InvalidParams);
                }
            }
        }

        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyParams {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ShutdownParams {
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FsWriteFileParams {
    pub transaction_id: String,
    pub path: String,
    /// Null means create-only; a string is the exact expected UTF-8 preimage.
    /// The field itself is required by Request::validate.
    pub expected_old_content: Option<String>,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct TransactionIdParams {
    pub transaction_id: String,
}

/// Explicitly registered operations. Arbitrary command execution is not a protocol operation.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskOperation {
    HashJson,
    DescribeJson,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExecuteTaskParams {
    pub task_id: String,
    pub operation: TaskOperation,
    pub payload: Value,
}

impl ExecuteTaskParams {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.task_id.is_empty()
            || self.task_id.len() > 64
            || !self.task_id.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
            })
        {
            return Err(ProtocolError::InvalidParams);
        }
        let encoded =
            serde_json::to_vec(&self.payload).map_err(|_| ProtocolError::InvalidParams)?;
        if encoded.len() > MAX_EXECUTION_TASK_BYTES {
            return Err(ProtocolError::InvalidParams);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExecuteTaskResult {
    pub task_id: String,
    pub operation: TaskOperation,
    pub output: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RpcErrorCode {
    InvalidRequest,
    UnsupportedVersion,
    Unauthorized,
    PolicyUnavailable,
    NotReady,
    ShuttingDown,
    FrameTooLarge,
    Conflict,
    InvalidPath,
    InvalidState,
    FilesystemUnavailable,
    ExecutionUnavailable,
    ExecutionFailed,
    ExecutionTimeout,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RpcError {
    pub code: RpcErrorCode,
    /// Stable, non-sensitive client message. Never carries internal error text.
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub protocol_version: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn success(request_id: u64, result: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id: Some(request_id),
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(request_id: Option<u64>, code: RpcErrorCode, message: &'static str) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            result: None,
            error: Some(RpcError {
                code,
                message: message.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("malformed IPC request")]
    InvalidJson(#[source] serde_json::Error),
    #[error("unsupported protocol version {received}; expected {expected}")]
    UnsupportedVersion { received: u16, expected: u16 },
    #[error("request identifier must be greater than zero")]
    InvalidRequestId,
    #[error("invalid method parameters")]
    InvalidParams,
}

pub fn decode_request(bytes: &[u8]) -> Result<Request, ProtocolError> {
    serde_json::from_slice(bytes).map_err(ProtocolError::InvalidJson)
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("IPC frame exceeds the configured limit")]
    TooLarge,
    #[error("empty IPC frame")]
    Empty,
    #[error("IPC frame ended before its newline delimiter")]
    Unterminated,
    #[error("IPC I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("IPC response serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// Reads one newline-delimited frame without ever buffering more than the
/// configured payload limit plus one bounded BufRead chunk.
pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Vec<u8>, FrameError> {
    let mut frame = Vec::with_capacity(1024);

    loop {
        let (consumed, payload, has_newline) = {
            let available = reader.fill_buf()?;
            if available.is_empty() {
                return Err(if frame.is_empty() {
                    FrameError::Empty
                } else {
                    FrameError::Unterminated
                });
            }

            if let Some(newline_at) = available.iter().position(|byte| *byte == b'\n') {
                if frame.len().saturating_add(newline_at) > MAX_FRAME_BYTES {
                    return Err(FrameError::TooLarge);
                }
                (newline_at + 1, available[..newline_at].to_vec(), true)
            } else {
                if frame.len().saturating_add(available.len()) > MAX_FRAME_BYTES {
                    return Err(FrameError::TooLarge);
                }
                (available.len(), available.to_vec(), false)
            }
        };

        frame.extend_from_slice(&payload);
        reader.consume(consumed);

        if has_newline {
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            if frame.is_empty() {
                return Err(FrameError::Empty);
            }
            return Ok(frame);
        }
    }
}

pub fn write_response<W: Write>(writer: &mut W, response: &Response) -> Result<(), FrameError> {
    let encoded = serde_json::to_vec(response)?;
    if encoded.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    writer.write_all(&encoded)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod execution_request_validation_tests {
    use super::*;
    use serde_json::json;

    fn request(params: Value) -> Request {
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 42,
            method: Method::ExecuteTask,
            params,
        }
    }

    #[test]
    fn execution_accepts_only_bounded_registered_operations() {
        assert!(request(json!({
            "task_id": "task_01",
            "operation": "hash_json",
            "payload": {"source": "fn main() {}"}
        }))
        .validate()
        .is_ok());

        assert!(request(json!({
            "task_id": "task-2",
            "operation": "hash_json",
            "payload": {},
            "command": "/bin/sh"
        }))
        .validate()
        .is_err());

        assert!(request(json!({
            "task_id": "task-3",
            "operation": "execute_shell",
            "payload": {}
        }))
        .validate()
        .is_err());
    }

    #[test]
    fn execution_rejects_invalid_ids_and_oversized_payloads() {
        assert!(request(json!({
            "task_id": "../escape",
            "operation": "hash_json",
            "payload": {}
        }))
        .validate()
        .is_err());

        assert!(request(json!({
            "task_id": "task-oversized",
            "operation": "hash_json",
            "payload": {"data": "x".repeat(MAX_EXECUTION_TASK_BYTES)}
        }))
        .validate()
        .is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn request(method: Method, params: Value) -> Request {
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 7,
            method,
            params,
        }
    }

    #[test]
    fn ping_accepts_only_an_empty_object() {
        assert!(request(Method::Ping, serde_json::json!({}))
            .validate()
            .is_ok());
        assert!(request(Method::Ping, serde_json::json!({"extra": true}))
            .validate()
            .is_err());
    }

    #[test]
    fn unknown_top_level_fields_are_rejected() {
        let data =
            br#"{"protocol_version":1,"request_id":1,"method":"ping","params":{},"admin":true}"#;
        assert!(decode_request(data).is_err());
    }

    #[test]
    fn unsupported_versions_fail_validation() {
        let mut req = request(Method::Ping, serde_json::json!({}));
        req.protocol_version = PROTOCOL_VERSION + 1;
        assert!(matches!(
            req.validate(),
            Err(ProtocolError::UnsupportedVersion { .. })
        ));
    }

    #[test]
    fn frame_reader_rejects_oversized_payload() {
        let mut input = vec![b'a'; MAX_FRAME_BYTES + 1];
        input.push(b'\n');
        let error = read_frame(&mut Cursor::new(input)).unwrap_err();
        assert!(matches!(error, FrameError::TooLarge));
    }

    #[test]
    fn frame_reader_accepts_crlf_and_round_trips_responses() {
        let mut input = Cursor::new(b"{\"ok\":true}\r\n".to_vec());
        assert_eq!(read_frame(&mut input).unwrap(), br#"{"ok":true}"#);

        let response = Response::success(3, serde_json::json!({"pong": true}));
        let mut bytes = Vec::new();
        write_response(&mut bytes, &response).unwrap();
        assert!(bytes.ends_with(b"\n"));
        let decoded: Response = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        assert_eq!(decoded, response);
    }
}

#[cfg(test)]
mod fs_request_validation_tests {
    use super::*;

    fn request(method: Method, params: Value) -> Request {
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 17,
            method,
            params,
        }
    }

    #[test]
    fn filesystem_write_requires_explicit_preimage_field() {
        let missing = request(
            Method::FsWriteFile,
            serde_json::json!({
                "transaction_id": "tx-a-1-1",
                "path": "src/lib.rs",
                "content": "source"
            }),
        );
        assert!(missing.validate().is_err());

        let create = request(
            Method::FsWriteFile,
            serde_json::json!({
                "transaction_id": "tx-a-1-1",
                "path": "src/lib.rs",
                "expected_old_content": null,
                "content": "source"
            }),
        );
        assert!(create.validate().is_ok());
    }

    #[test]
    fn filesystem_params_reject_unknown_fields_and_oversized_contents() {
        let extra = request(
            Method::FsCommit,
            serde_json::json!({"transaction_id": "tx-a-1-1", "force": true}),
        );
        assert!(extra.validate().is_err());

        let too_large = request(
            Method::FsWriteFile,
            serde_json::json!({
                "transaction_id": "tx-a-1-1",
                "path": "x",
                "expected_old_content": null,
                "content": "a".repeat(49 * 1024)
            }),
        );
        assert!(too_large.validate().is_err());
    }
}
