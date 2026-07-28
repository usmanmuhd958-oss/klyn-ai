// [KLYN-V4.7-SELF-HEALED-AST-NODE: Cannot use import statement outside a module]
import fs from 'node:fs';
import path from 'node:path';

const memoryMap = new Map();

export function initializeVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
}

export function storeMemory(id, namespace, embedding, payload, tags) {
  memoryMap.set(id, { id, namespace, embedding, payload, tags });
}

export function queryMemory(namespace, embedding, topK = 5) {
  return Array.from(memoryMap.values()).slice(0, topK);
}
