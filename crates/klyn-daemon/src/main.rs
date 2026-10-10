//! KEL v1 daemon entrypoint.
//!
//! Secrets are injected by the service manager/secret provider. Do not put key material
//! in source control, command-line arguments, or agent-controlled environment variables.
use ed25519_dalek::{SigningKey, VerifyingKey};
use klyn_daemon::{rpc, EvidenceStore};
use std::{collections::BTreeMap, env, error::Error, path::PathBuf};

fn required(name: &str) -> Result<String, Box<dyn Error>> {
    let value = env::var(name)?;
    if value.trim().is_empty() {
        return Err(format!("{name} must not be empty").into());
    }
    Ok(value)
}

fn raw_32_byte_hex(name: &str, value: &str) -> Result<[u8; 32], Box<dyn Error>> {
    let bytes = hex::decode(value).map_err(|_| format!("{name} must be 64 hex characters"))?;
    bytes.try_into().map_err(|_| format!("{name} must decode to exactly 32 bytes").into())
}

fn main() -> Result<(), Box<dyn Error>> {
    let socket_path = PathBuf::from(required("KEL_SOCKET_PATH")?);
    let database_path = PathBuf::from(required("KEL_DATABASE_PATH")?);
    let ledger_id = required("KEL_LEDGER_ID")?;
    let checkpoint_key_id = required("KEL_CHECKPOINT_KEY_ID")?;
    let checkpoint_key_epoch = required("KEL_CHECKPOINT_KEY_EPOCH")?;
    checkpoint_key_epoch.parse::<u64>()
        .map_err(|_| "KEL_CHECKPOINT_KEY_EPOCH must be a decimal unsigned integer")?;

    let auth_token = required("KEL_RPC_AUTH_TOKEN_HEX")?;
    if auth_token.len() != 64 || !auth_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("KEL_RPC_AUTH_TOKEN_HEX must contain exactly 32 bytes of hex".into());
    }

    let private_seed = raw_32_byte_hex(
        "KEL_CHECKPOINT_PRIVATE_KEY_HEX",
        &required("KEL_CHECKPOINT_PRIVATE_KEY_HEX")?,
    )?;
    let checkpoint_signing_key = SigningKey::from_bytes(&private_seed);

    let producer_key_json = required("KEL_PRODUCER_KEYS_JSON")?;
    let producer_hex: BTreeMap<String, String> = serde_json::from_str(&producer_key_json)?;
    if producer_hex.is_empty() {
        return Err("KEL_PRODUCER_KEYS_JSON must include at least one trusted producer key".into());
    }
    let mut producer_keys = BTreeMap::new();
    for (key_id, encoded) in producer_hex {
        if key_id.trim().is_empty() {
            return Err("producer key ids must not be empty".into());
        }
        let bytes = raw_32_byte_hex("producer public key", &encoded)?;
        producer_keys.insert(key_id, VerifyingKey::from_bytes(&bytes)?);
    }

    let store = EvidenceStore::open(
        database_path,
        ledger_id,
        checkpoint_key_id,
        checkpoint_key_epoch,
        checkpoint_signing_key,
        producer_keys,
    )?;
    eprintln!("KEL daemon initialized; socket={}", socket_path.display());
    rpc::serve(socket_path, auth_token, store)?;
    Ok(())
}
