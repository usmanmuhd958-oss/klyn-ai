//! Minimal fail-closed worker protocol endpoint.
//!
//! The control plane uses a bounded binary protocol over pre-mapped SPSC rings.
//! No JSON serialization, heap allocation, or socket creation occurs in the
//! command loop. This worker remains deliberately limited to ping and shutdown;
//! no model-supplied command, shell, filesystem mutation, or process execution
//! is interpreted here.

use std::time::Duration;

use klyn_sandbox::{
    ipc_ring::{WORKER_CMD_PING, WORKER_CMD_SHUTDOWN, WORKER_RESP_PING, WORKER_RESP_SHUTDOWN},
    worker_bootstrap,
};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(3);

pub fn run() -> Result<(), String> {
    // Verify the sealed manifest, capability, image, cgroup controls, broker,
    // Landlock and seccomp. This call returns only after the final supervisor
    // ACK, and ring mappings are established only after signed claims verify.
    let context = worker_bootstrap::initialize().map_err(|error| error.to_string())?;
    let mut command_ring = context.command_ring;
    let mut response_ring = context.response_ring;
    let _broker = context.broker;

    loop {
        // Read only a single opcode into a scalar before retiring the frame.
        // The mapping is bounded and read-only at the consumer endpoint.
        let opcode = {
            let frame = command_ring
                .wait_peek(None)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "worker command ring unexpectedly timed out".to_owned())?;
            let payload = frame.payload();
            if payload.len() != 1 {
                return Err("worker command frame has an invalid length".into());
            }
            let opcode = payload[0];
            frame.consume().map_err(|error| error.to_string())?;
            opcode
        };

        match opcode {
            WORKER_CMD_PING => {
                let pid = unsafe { libc::getpid() };
                let mut response = [0u8; 6];
                response[0] = WORKER_RESP_PING;
                response[1..5].copy_from_slice(&(pid as u32).to_le_bytes());
                response[5] = u8::from(pid == 1);
                response_ring
                    .push_wait(&response, RESPONSE_TIMEOUT)
                    .map_err(|error| error.to_string())?;
            }
            WORKER_CMD_SHUTDOWN => {
                response_ring
                    .push_wait(&[WORKER_RESP_SHUTDOWN], RESPONSE_TIMEOUT)
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            _ => return Err("unsupported worker command opcode".into()),
        }
    }
}
