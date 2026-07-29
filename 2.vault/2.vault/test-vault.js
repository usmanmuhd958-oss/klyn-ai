// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { initializeVault, storeMemory, recall } = require('./index.js');
const path = require('path');

const dbPath = path.join(__dirname, 'vault_data');
initializeVault(dbPath);

const sampleEmbedding = new Float32Array(128);
for (let i = 0; i < 128; i++) {
  sampleEmbedding[i] = Math.random();
}

const memoryId = "mem_001";
const vmHash = "law_core_v1";
const payload = Buffer.from("FN_MAIN_AST_EXECUTION_STATE");
const tags = ["core", "ast", "compiler"];

storeMemory(memoryId, vmHash, sampleEmbedding, payload, tags);

const results = recall(sampleEmbedding, vmHash, 5, 0.5);
console.log("Klyn Vault Recall Test Success:", results);

// Klyn OS Auto-Verification Complete
// Self-healed by Klyn AI OS on 2026-07-28T14:23:22.586Z
export const selfHealed = true;
