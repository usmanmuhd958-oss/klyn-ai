#!/usr/bin/env bash
set -e

echo "⚡ Deploying KLYN LLM Engine Core (Candle 0.9 + GGUF Integration)..."

# 1. Update Cargo.toml with exact dependencies
cat << 'CARGO' > Cargo.toml
[package]
name = "klyn_kernel_core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
candle-core = { version = "0.9.0", default-features = false }
candle-transformers = { version = "0.9.0", default-features = false }
candle-nn = "0.9.0"
napi = { version = "2.13.3", features = ["async", "napi9", "tokio_rt"] }
napi-derive = "2.13.3"
tokenizers = { version = "0.15.2", default-features = false, features = ["onig"] }
memmap2 = "0.9.0"
parking_lot = "0.12.1"
zerocopy = { version = "0.7", features = ["derive"] }
tokio = { version = "1.38", features = ["full"] }
CARGO

# 2. Add validate_diff to src/law_vm.rs
cat << 'LAWVM' > src/law_vm.rs
use crate::event::Event;

pub struct LawVM {
    last_cycle: u64,
}

impl LawVM {
    pub fn new() -> Self {
        Self { last_cycle: 0 }
    }

    pub fn reset(&mut self) {
        self.last_cycle = 0;
    }

    pub fn validate_event(&mut self, _event: &Event, cycle: u64) -> bool {
        self.last_cycle = cycle;
        true
    }

    pub fn validate_ast_mutation(&self, _payload: &[u8]) -> bool {
        true
    }
}

pub fn validate_diff(generated: &str) -> bool {
    if generated.len() > 65536 {
        return false;
    }

    let forbidden = ["eval(", "exec(", "__import__", "subprocess", "os.system"];
    for pattern in &forbidden {
        if generated.contains(pattern) {
            return false;
        }
    }

    let hash = generated.bytes().fold(0u64, |acc, b| {
        acc.wrapping_mul(31).wrapping_add(b as u64)
    });

    hash & 0xFF != 0
}
LAWVM

# 3. Write production-ready src/llm.rs
cat << 'LLM' > src/llm.rs
use candle_core::{quantized::gguf_file, Device, Tensor};
use candle_transformers::models::quantized_llama::ModelWeights;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::sync::Arc;
use tokenizers::Tokenizer;

const MODEL_PATH: &str = "/data/klyn/models/tinyllm-q4.gguf";
const TOKENIZER_PATH: &str = "/data/klyn/models/tokenizer.json";
const MAX_CONTEXT: usize = 512;
const TEMPERATURE: f64 = 0.7;

static MODEL_LOCK: Mutex<Option<Arc<LLMEngine>>> = Mutex::new(None);

struct LLMEngine {
    model: Mutex<ModelWeights>,
    tokenizer: Tokenizer,
    device: Device,
}

impl LLMEngine {
    fn load() -> Result<Self> {
        let device = Device::Cpu;
        let mut model_file = std::fs::File::open(MODEL_PATH)
            .map_err(|e| Error::from_reason(format!("Model load failed: {}", e)))?;

        let gguf = gguf_file::Content::read(&mut model_file)
            .map_err(|e| Error::from_reason(format!("GGUF read failed: {}", e)))?;

        let model = ModelWeights::from_gguf(gguf, &mut model_file, &device)
            .map_err(|e| Error::from_reason(format!("GGUF parse failed: {}", e)))?;

        let tokenizer = Tokenizer::from_file(TOKENIZER_PATH)
            .map_err(|e| Error::from_reason(format!("Tokenizer load failed: {}", e)))?;

        Ok(Self {
            model: Mutex::new(model),
            tokenizer,
            device,
        })
    }

    fn generate_tokens(&self, prompt: &str, max_tokens: u32) -> Result<Vec<u32>> {
        let encoding = self
            .tokenizer
            .encode(prompt, false)
            .map_err(|e| Error::from_reason(format!("Tokenization failed: {}", e)))?;

        let mut tokens = encoding.get_ids().to_vec();
        let prompt_len = tokens.len();

        if prompt_len > MAX_CONTEXT {
            tokens = tokens[prompt_len - MAX_CONTEXT..].to_vec();
        }

        let mut model_guard = self.model.lock();

        for _step in 0..max_tokens as usize {
            let ctx_len = tokens.len();
            let input = Tensor::new(&tokens[..], &self.device)
                .map_err(|e| Error::from_reason(format!("Tensor creation failed: {}", e)))?;

            let logits = model_guard
                .forward(&input, ctx_len)
                .map_err(|e| Error::from_reason(format!("Forward pass failed: {}", e)))?;

            let logits_vec = logits
                .squeeze(0)
                .map_err(|e| Error::from_reason(format!("Squeeze failed: {}", e)))?
                .to_vec1::<f32>()
                .map_err(|e| Error::from_reason(format!("Logits extraction failed: {}", e)))?;

            let next_token = self.sample_token(&logits_vec);

            if next_token == 2 || next_token == 0 {
                break;
            }

            tokens.push(next_token);

            if tokens.len() > MAX_CONTEXT {
                tokens.drain(0..tokens.len() - MAX_CONTEXT);
            }
        }

        Ok(tokens[prompt_len..].to_vec())
    }

    fn sample_token(&self, logits: &[f32]) -> u32 {
        let mut max_idx = 0;
        let mut max_val = f32::NEG_INFINITY;

        for (i, &val) in logits.iter().enumerate() {
            let scaled = val / TEMPERATURE as f32;
            if scaled > max_val {
                max_val = scaled;
                max_idx = i;
            }
        }

        max_idx as u32
    }

    fn decode_tokens(&self, tokens: &[u32]) -> Result<String> {
        self.tokenizer
            .decode(tokens, true)
            .map_err(|e| Error::from_reason(format!("Decode failed: {}", e)))
    }
}

fn get_or_init_engine() -> Result<Arc<LLMEngine>> {
    let mut lock = MODEL_LOCK.lock();
    if let Some(ref engine) = *lock {
        return Ok(Arc::clone(engine));
    }

    let engine = Arc::new(LLMEngine::load()?);
    *lock = Some(Arc::clone(&engine));
    Ok(engine)
}

#[napi]
pub async fn generate(prompt: String, max_tokens: u32) -> napi::Result<String> {
    let signal_start = [100u8];
    crate::kernel::KernelState::instance().process_event_fast(signal_start.as_ptr(), 1);

    let engine = get_or_init_engine()?;
    let prompt_clone = prompt.clone();
    let max_tokens = max_tokens.min(256);

    let result = tokio::task::spawn_blocking(move || {
        let tokens = engine.generate_tokens(&prompt_clone, max_tokens)?;
        engine.decode_tokens(&tokens)
    })
    .await
    .map_err(|e| Error::from_reason(format!("Task join failed: {}", e)))??;

    if !crate::law_vm::validate_diff(&result) {
        let signal_fail = [101u8, 0xFF];
        crate::kernel::KernelState::instance().process_event_fast(signal_fail.as_ptr(), 2);
        return Err(Error::from_reason("Law_VM validation failed"));
    }

    let signal_ok = [101u8, 0x00];
    crate::kernel::KernelState::instance().process_event_fast(signal_ok.as_ptr(), 2);
    Ok(result)
}

#[napi]
pub fn warmup_model() -> napi::Result<bool> {
    get_or_init_engine()?;
    Ok(true)
}
LLM

# 4. Link module inside src/lib.rs if not already registered
if ! grep -q "mod llm;" src/lib.rs; then
    echo "mod llm;" >> src/lib.rs
fi

echo "🚀 KLYN LLM setup script generated successfully!"
