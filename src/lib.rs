#![deny(clippy::all)]
#![allow(clippy::missing_safety_doc)]

use napi::{bindgen_prelude::*, JsBuffer};
use napi_derive::napi;
use std::sync::OnceLock;

mod index;
mod simd;
mod storage;
mod vault;

use vault::Vault;

static VAULT_INSTANCE: OnceLock<Vault> = OnceLock::new();

fn get_vault() -> &'static Vault {
    VAULT_INSTANCE.get_or_init(Vault::new)
}

#[napi(object)]
pub struct RecallResult {
    pub id: String,
    pub score: f64,
    pub timestamp: i64,
    pub payload: Buffer,
    pub tags: Vec<String>,
}

#[napi]
pub fn initialize_vault(path: String) -> Result<()> {
    get_vault()
        .initialize(path)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn store_memory(
    id: String,
    law_vm_hash: String,
    embedding: Float32Array,
    payload: JsBuffer,
    tags: Vec<String>,
) -> Result<String> {
    let data = payload.into_value()?;
    get_vault()
        .store_memory(id, law_vm_hash, embedding.as_ref().to_vec(), data.to_vec(), tags)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn recall(
    query_embedding: Float32Array,
    law_vm_hash: String,
    top_k: u32,
    threshold: f64,
) -> Result<Vec<RecallResult>> {
    let results = get_vault()
        .recall(query_embedding.as_ref().to_vec(), law_vm_hash, top_k as usize, threshold)
        .map_err(|e| Error::from_reason(e))?;

    Ok(results
        .into_iter()
        .map(|r| RecallResult {
            id: r.id,
            score: r.score,
            timestamp: r.timestamp,
            payload: Buffer::from(r.payload),
            tags: r.tags,
        })
        .collect())
}
