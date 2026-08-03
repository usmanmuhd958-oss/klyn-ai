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

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function recall(embedding, namespace, topK = 5, threshold = 0) {
  const scored = [];
  for (const m of memoryMap.values()) {
    if (namespace && m.namespace !== namespace) continue;
    const sim = cosineSimilarity(embedding, m.embedding);
    if (sim >= threshold) scored.push({ ...m, similarity: sim, score: sim });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}
