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

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    Ping,
    DaemonStatus,
    DaemonShutdown,
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
            Method::Ping | Method::DaemonStatus => {
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
