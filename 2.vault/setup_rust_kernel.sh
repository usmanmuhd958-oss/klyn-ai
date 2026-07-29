#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS v3.0 - Rust Native Core Setup Orchestrator
# Target: ARM64 / Termux / Node.js Native Addon (napi-rs)
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${CYAN}[+] Initializing KLYN AI OS Rust Native Directory Structure...${NC}"

# Create directories
mkdir -p native/kernel_core/src
mkdir -p native/kernel_core/scripts

# 1. Generate Cargo.toml
echo -e "${GREEN}[+] Writing native/kernel_core/Cargo.toml...${NC}"
cat << 'CARGO' > native/kernel_core/Cargo.toml
[package]
name = "klyn_kernel_core"
version = "3.0.0"
edition = "2021"
authors = ["KLYN AI OS Architecture Team"]
description = "Ultra-low latency Rust native kernel core for KLYN AI OS"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
napi = { version = "2.16.2", default-features = false, features = ["async", "napi4", "serde-json"] }
napi-derive = "2.16.0"
tokio = { version = "1.36.0", features = ["sync", "rt", "macros"] }
dashmap = "5.5.3"
bytes = "1.5.0"
smallvec = { version = "1.13.1", features = ["serde"] }
serde = { version = "1.0.197", features = ["derive"] }
serde_json = "1.0.114"
thiserror = "1.0.57"
aes-gcm = "0.10.3"
rand = "0.8.5"
zeroize = { version = "1.7.0", features = ["zeroize_derive"] }
tracing = "0.1.40"

[build-dependencies]
napi-build = "2.1.3"

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true
CARGO

# 2. Open nano for src/lib.rs (User drops Sonnet's Rust code here)
echo -e "${YELLOW}[!] Opening nano for native/kernel_core/src/lib.rs...${NC}"
echo -e "${YELLOW}[!] Paste Sonnet's full 'kernel_core.rs' code inside and press Ctrl+O -> Enter -> Ctrl+X${NC}"
sleep 2

nano native/kernel_core/src/lib.rs

# 3. Generate index.d.ts
echo -e "${GREEN}[+] Writing native/kernel_core/index.d.ts...${NC}"
cat << 'TS_DEF' > native/kernel_core/index.d.ts
/**
 * KLYN AI OS v3.0 - Kernel Core (Rust Native Addon Bindings)
 */

export interface RuleDefinition {
  id: string;
  condition: string;
  action: string;
}

export interface RuleEvaluationResult {
  ruleId: string;
  passed: boolean;
  action?: string;
}

export class NativeKernel {
  constructor();
  publishEvent(topic: string, payload: Uint8Array): Promise<number>;
  addRule(id: string, condition: string, action: string): void;
  evaluateRules(contextJson: string): RuleEvaluationResult[];
  storeSecret(key: string, secret: string): void;
  getSecret(key: string): string;
}

export function initKernel(): NativeKernel;
TS_DEF

# 4. Generate Build Script
echo -e "${GREEN}[+] Creating Native Build Script at native/kernel_core/scripts/build.sh...${NC}"
cat << 'BUILD_SCRIPT' > native/kernel_core/scripts/build.sh
#!/usr/bin/env bash
set -euo pipefail

echo "[+] Building KLYN AI OS Rust Core Native Binary..."
cargo build --manifest-path native/kernel_core/Cargo.toml --release

echo "[✓] Rust Native Kernel Core Compiled Successfully! 🚀"
BUILD_SCRIPT

chmod +x native/kernel_core/scripts/build.sh

echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}  RUST CORE MODULE STRUCTURE CREATED SUCCESSFULLY! 💯 ${NC}"
echo -e "${CYAN}====================================================${NC}"
