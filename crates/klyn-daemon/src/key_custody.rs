//! Checkpoint signing through an external key-custody service.
//!
//! The daemon holds only a public Ed25519 key. A separate signer process owns the
//! HSM/PKCS#11 session or cloud-KMS credentials. Signing requests are length-prefixed
//! JSON over a private Unix socket; responses are verified locally before use.
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read, Write},
    os::unix::fs::PermissionsExt,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    time::Duration,
};
use thiserror::Error;

const MAX_SIGNER_FRAME: usize = 64 * 1024;
const SIGNER_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum SigningProviderError {
    #[error("signer transport failed: {0}")]
    Io(#[from] io::Error),
    #[error("signer protocol error: {0}")]
    Protocol(String),
    #[error("signer rejected operation: {0}")]
    Rejected(String),
    #[error("signature is invalid for the configured public key")]
    InvalidSignature,
}

pub type SigningResult<T> = std::result::Result<T, SigningProviderError>;

/// Signing interface used by the append-only ledger. Implementations should route
/// signing operations to an HSM, PKCS#11 module, cloud KMS API, or isolated signer agent.
pub trait CheckpointSigner: Send + Sync {
    fn key_id(&self) -> &str;
    fn key_epoch(&self) -> &str;
    fn verifying_key(&self) -> &VerifyingKey;
    fn sign_pae(&self, pre_auth_encoding: &[u8]) -> SigningResult<[u8; 64]>;
}

/// Authenticated external signer client. It never accepts or stores private key bytes.
pub struct ExternalSignerClient {
    socket_path: PathBuf,
    auth_token: String,
    key_id: String,
    key_epoch: String,
    verifying_key: Option<VerifyingKey>,
    timeout: Duration,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignerRequest<'a, P> {
    version: u32,
    token: &'a str,
    method: &'a str,
    params: P,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignerResponse<T> {
    version: u32,
    result: Option<T>,
    error: Option<SignerErrorBody>,
}

#[derive(Deserialize)]
struct SignerErrorBody {
    code: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignerInfo {
    key_id: String,
    key_epoch: String,
    public_key_hex: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignParams<'a> {
    key_id: &'a str,
    payload_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignResult {
    signature_base64: String,
}

impl ExternalSignerClient {
    pub fn connect(
        socket_path: impl AsRef<Path>,
        auth_token: String,
        timeout: Duration,
    ) -> SigningResult<Self> {
        if auth_token.len() != 64 || !auth_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SigningProviderError::Protocol(
                "signer auth token must be 32 bytes encoded as 64 hex characters".into(),
            ));
        }
        let socket_path = socket_path.as_ref().to_path_buf();
        let mut client = Self {
            socket_path,
            auth_token,
            key_id: String::new(),
            key_epoch: String::new(),
            verifying_key: None,
            timeout,
        };
        let info: SignerInfo = client.request("signer.info", serde_json::json!({}))?;
        if info.key_id.trim().is_empty() ||
            info.key_epoch.parse::<u64>().is_err() ||
            info.public_key_hex.len() != 64 ||
            !info.public_key_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SigningProviderError::Protocol("signer.info returned invalid identity metadata".into()));
        }
        let public_bytes: [u8; 32] = hex::decode(&info.public_key_hex)
            .map_err(|error| SigningProviderError::Protocol(error.to_string()))?
            .try_into()
            .map_err(|_| SigningProviderError::Protocol("signer public key must be 32 bytes".into()))?;
        client.verifying_key = Some(VerifyingKey::from_bytes(&public_bytes)
            .map_err(|error| SigningProviderError::Protocol(error.to_string()))?);
        client.key_id = info.key_id;
        client.key_epoch = info.key_epoch;
        Ok(client)
    }

    /// Load a signer auth token from a protected file (mode 0600 or stricter).
    pub fn token_from_file(path: impl AsRef<Path>) -> SigningResult<String> {
        let metadata = fs::symlink_metadata(path.as_ref())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() ||
            metadata.permissions().mode() & 0o077 != 0 {
            return Err(SigningProviderError::Protocol(
                "signer token must be a regular file with permissions 0600 or stricter".into(),
            ));
        }
        let token = fs::read_to_string(path)?;
        let token = token.trim().to_owned();
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SigningProviderError::Protocol("invalid signer token file content".into()));
        }
        Ok(token)
    }

    fn request<P: Serialize, T: DeserializeOwned>(
        &self,
        method: &str,
        params: P,
    ) -> SigningResult<T> {
        let request = SignerRequest {
            version: SIGNER_PROTOCOL_VERSION,
            token: &self.auth_token,
            method,
            params,
        };
        let bytes = serde_json::to_vec(&request)
            .map_err(|error| SigningProviderError::Protocol(error.to_string()))?;
        if bytes.is_empty() || bytes.len() > MAX_SIGNER_FRAME {
            return Err(SigningProviderError::Protocol("signer request exceeds frame limit".into()));
        }
        let mut stream = UnixStream::connect(&self.socket_path)?;
        stream.set_read_timeout(Some(self.timeout))?;
        stream.set_write_timeout(Some(self.timeout))?;
        stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
        stream.write_all(&bytes)?;
        stream.flush()?;

        let mut header = [0; 4];
        stream.read_exact(&mut header)?;
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 || length > MAX_SIGNER_FRAME {
            return Err(SigningProviderError::Protocol("invalid signer response frame length".into()));
        }
        let mut response_bytes = vec![0; length];
        stream.read_exact(&mut response_bytes)?;
        let response: SignerResponse<T> = serde_json::from_slice(&response_bytes)
            .map_err(|error| SigningProviderError::Protocol(error.to_string()))?;
        if response.version != SIGNER_PROTOCOL_VERSION {
            return Err(SigningProviderError::Protocol("unsupported signer response version".into()));
        }
        if let Some(error) = response.error {
            return Err(SigningProviderError::Rejected(format!("{}: {}", error.code, error.message)));
        }
        response.result.ok_or_else(|| SigningProviderError::Protocol("signer response omitted result".into()))
    }
}

impl CheckpointSigner for ExternalSignerClient {
    fn key_id(&self) -> &str { &self.key_id }
    fn key_epoch(&self) -> &str { &self.key_epoch }
    fn verifying_key(&self) -> &VerifyingKey { self.verifying_key.as_ref().expect("signer public key initialized") }

    fn sign_pae(&self, pre_auth_encoding: &[u8]) -> SigningResult<[u8; 64]> {
        let result: SignResult = self.request(
            "signer.sign",
            SignParams {
                key_id: &self.key_id,
                payload_base64: BASE64.encode(pre_auth_encoding),
            },
        )?;
        let raw = BASE64.decode(result.signature_base64)
            .map_err(|error| SigningProviderError::Protocol(error.to_string()))?;
        if raw.len() != 64 {
            return Err(SigningProviderError::Protocol("Ed25519 signature must be 64 bytes".into()));
        }
        let signature: [u8; 64] = raw.try_into()
            .map_err(|_| SigningProviderError::Protocol("invalid signature length".into()))?;
        self.verifying_key().verify(pre_auth_encoding, &Signature::from_bytes(&signature))
            .map_err(|_| SigningProviderError::InvalidSignature)?;
        Ok(signature)
    }
}
