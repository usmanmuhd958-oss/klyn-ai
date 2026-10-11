//! KEL v1 daemon entrypoint.
//!
//! The daemon never loads the checkpoint private seed. A separate signer agent owns
//! HSM/PKCS#11 or cloud KMS credentials and exposes the authenticated signer protocol.
use ed25519_dalek::VerifyingKey;
use klyn_daemon::{key_custody::ExternalSignerClient, rpc, EvidenceStore};
use std::{collections::BTreeMap, env, error::Error, path::PathBuf, sync::Arc, time::Duration};

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
    let auth_token = required("KEL_RPC_AUTH_TOKEN_HEX")?;
    if auth_token.len() != 64 || !auth_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("KEL_RPC_AUTH_TOKEN_HEX must contain exactly 32 bytes of hex".into());
    }

    let signer_socket = PathBuf::from(required("KEL_SIGNER_SOCKET_PATH")?);
    let signer_token_path = PathBuf::from(required("KEL_SIGNER_AUTH_TOKEN_FILE")?);
    let signer_token = ExternalSignerClient::token_from_file(signer_token_path)?;
    let signer = Arc::new(ExternalSignerClient::connect(
        signer_socket,
        signer_token,
        Duration::from_secs(5),
    )?);

    // Only public producer keys are configured here; no private-key seed enters this process.
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

    let allowed_uid = match env::var("KEL_RPC_ALLOWED_UID") {
        Ok(value) => value.parse::<u32>().map_err(|_| "KEL_RPC_ALLOWED_UID must be a numeric UID")?,
        Err(_) => unsafe { libc::geteuid() },
    };
    let max_connections = match env::var("KEL_RPC_MAX_CONNECTIONS") {
        Ok(value) => value.parse::<usize>().map_err(|_| "KEL_RPC_MAX_CONNECTIONS must be an integer")?,
        Err(_) => 64,
    };

    let store = EvidenceStore::open_with_signer(database_path, ledger_id, signer, producer_keys)?;
    eprintln!("KEL daemon initialized; socket={}", socket_path.display());
    rpc::serve(socket_path, auth_token, store, allowed_uid, max_connections)?;
    Ok(())
}
