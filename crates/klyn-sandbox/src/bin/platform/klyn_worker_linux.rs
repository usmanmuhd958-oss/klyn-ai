//! Minimal fail-closed protocol endpoint for native sandbox qualification.
//!
//! It only supports ping and shutdown. No model-supplied command, shell,
//! filesystem mutation, or arbitrary process execution is interpreted here.
//! Access to resources remains broker-mediated and read-only in this phase.

use std::io::{self, BufRead, BufReader, Write};

use klyn_sandbox::worker_bootstrap;

const MAX_COMMAND_BYTES: usize = klyn_sandbox::MAX_BROKER_FRAME_BYTES;

pub fn run() -> Result<(), String> {
    // Verify the sealed manifest, capability, image, cgroup controls, broker,
    // Landlock and seccomp. This call returns only after final supervisor ACK.
    let _context = worker_bootstrap::initialize().map_err(|error| error.to_string())?;
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = stdout.lock();

    while let Some(line) = read_bounded_line(&mut reader)? {
        let request: serde_json::Value =
            serde_json::from_slice(&line).map_err(|_| "invalid worker request JSON".to_owned())?;
        let object = request
            .as_object()
            .ok_or_else(|| "worker request must be a JSON object".to_owned())?;
        if object.len() != 1 {
            return Err("worker request contains unknown fields".into());
        }
        let operation = object
            .get("op")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "worker operation is missing".to_owned())?;
        match operation {
            "ping" => {
                let pid = unsafe { libc::getpid() };
                let response = serde_json::json!({
                    "ok": true,
                    "namespace_init": pid == 1,
                    "pid": pid
                });
                write_response(&mut writer, &response)?;
            }
            "shutdown" => {
                write_response(
                    &mut writer,
                    &serde_json::json!({"ok": true, "state": "stopping"}),
                )?;
                return Ok(());
            }
            _ => return Err("unsupported worker operation".into()),
        }
    }
    Err("supervisor closed worker input without a shutdown request".into())
}

fn read_bounded_line<R: BufRead>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf().map_err(|error| error.to_string())?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("truncated worker request".into())
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let segment_len = newline.unwrap_or(available.len());
        if line.len().saturating_add(segment_len) > MAX_COMMAND_BYTES {
            return Err("worker request exceeds the frame limit".into());
        }
        line.extend_from_slice(&available[..segment_len]);
        reader.consume(segment_len + if newline.is_some() { 1 } else { 0 });
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

fn write_response(writer: &mut impl Write, value: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_COMMAND_BYTES {
        return Err("worker response exceeds the frame limit".into());
    }
    writer.write_all(&bytes).map_err(|error| error.to_string())?;
    writer.write_all(b"\n").map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}
