//! Fixed, deterministic task operations executed only after worker bootstrap.
use klyn_protocol::{ExecuteTaskParams, TaskOperation};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::SandboxError;

pub fn execute_registered_operation(
    params: &ExecuteTaskParams,
) -> Result<Value, SandboxError> {
    params.validate().map_err(|_| {
        SandboxError::InvalidConfig("worker task payload rejected".into())
    })?;
    let canonical = serde_json::to_vec(&params.payload)?;
    let digest = hex_digest(&canonical);

    Ok(match params.operation {
        TaskOperation::HashJson => json!({
            "sha256": digest,
            "canonical_json_bytes": canonical.len()
        }),
        TaskOperation::DescribeJson => {
            let (kind, item_count) = match &params.payload {
                Value::Null => ("null", 0),
                Value::Bool(_) => ("boolean", 0),
                Value::Number(_) => ("number", 0),
                Value::String(value) => ("string", value.chars().count()),
                Value::Array(values) => ("array", values.len()),
                Value::Object(values) => ("object", values.len()),
            };
            json!({
                "kind": kind,
                "items": item_count,
                "canonical_json_bytes": canonical.len(),
                "sha256": digest
            })
        }
    })
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut output, "{byte:02x}")
            .expect("writing hex to String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn registered_operations_return_deterministic_metadata() {
        let params = ExecuteTaskParams {
            task_id: "task-unit".into(),
            operation: TaskOperation::DescribeJson,
            payload: json!({"a": 1, "b": [true]}),
        };
        let result = execute_registered_operation(&params).unwrap();
        assert_eq!(result["kind"], "object");
        assert_eq!(result["items"], 2);
        assert_eq!(result["sha256"].as_str().unwrap().len(), 64);
    }
}
