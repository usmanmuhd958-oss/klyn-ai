//! Minimal trusted worker binary for KLYN's bounded task protocol.
use std::{
    io::{self, BufReader, Write},
    process::ExitCode,
};

use klyn_protocol::{
    read_frame, ExecuteTaskParams, ExecuteTaskResult, MAX_EXECUTION_RESULT_BYTES,
    MAX_EXECUTION_TASK_BYTES,
};
use serde_json::to_vec;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::from(125),
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // Task bytes are not read until manifest/capability, cgroup, broker,
    // Landlock, seccomp, and the supervisor's final release are verified.
    let _context = klyn_sandbox::worker_bootstrap::initialize()?;

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let frame = read_frame(&mut reader)?;
    if frame.len() > MAX_EXECUTION_TASK_BYTES {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "task exceeds limit").into(),
        );
    }
    let params: ExecuteTaskParams = serde_json::from_slice(&frame)?;
    params
        .validate()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "task parameters rejected"))?;

    let output = klyn_sandbox::task::execute_registered_operation(&params)?;
    let result = ExecuteTaskResult {
        task_id: params.task_id,
        operation: params.operation,
        output,
    };
    let encoded = to_vec(&result)?;
    if encoded.len() > MAX_EXECUTION_RESULT_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "result exceeds limit").into());
    }

    let stdout = io::stdout();
    let mut writer = stdout.lock();
    writer.write_all(&encoded)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}
