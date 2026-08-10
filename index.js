// [KLYN-V4.7-SELF-HEALED-AST-NODE: Cannot use import statement outside a module]
import fs from 'node:fs';
import path from 'node:path';

const memoryMap = new Map();
let vaultFile = null;

function saveVault() {
  if (!vaultFile) return;

  const data = [];

  for (const item of memoryMap.values()) {
    data.push({
      ...item,
      payload: Buffer.isBuffer(item.payload)
        ? item.payload.toString("base64")
        : item.payload
    });
  }

  fs.writeFileSync(
    vaultFile,
    JSON.stringify(data)
  );
}

function loadVault() {
  if (!vaultFile || !fs.existsSync(vaultFile)) return;

  try {
    const data = JSON.parse(
      fs.readFileSync(vaultFile, "utf8")
    );

    for (const item of data) {
      item.payload = Buffer.from(
        item.payload,
        "base64"
      );

      memoryMap.set(item.id, item);
    }

  } catch {}
}

export function initializeVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  vaultFile = path.join(
    vaultPath,
    "memory-store.json"
  );

  loadVault();
}

export function storeMemory(id, namespace, embedding, payload, tags) {
  memoryMap.set(id, { id, namespace, embedding, payload, tags });
  saveVault();
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

    let boost = 0;

    try {
      let text = "";
      try {
        if (Buffer.isBuffer(m.payload)) {
          text = m.payload.toString("utf8").toLowerCase();
        } else {
          text = JSON.stringify(m.payload).toLowerCase();
        }
      } catch {
        text = "";
      }

      const tags = (m.tags || []).join(" ").toLowerCase();

      if (text.includes("klyn")) boost += 0.15;
      if (text.includes("server")) boost += 0.20;
      if (text.includes("gateway")) boost += 0.20;

      const pathText = text + tags;

      if (pathText.includes("klyn_server")) boost += 0.50;
      if (pathText.includes("api/server")) boost += 0.30;
      if (pathText.includes("gateway")) boost += 0.25;

      if (tags.includes("ast")) boost += 0.05;
    } catch {}

    const score = sim + boost;

    if (score >= threshold) {
      scored.push({ ...m, similarity: sim, score });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}


export function memoryStats() {
  return {
    size: memoryMap.size,
    namespaces: [...new Set(
      Array.from(memoryMap.values()).map(m => m.namespace)
    )]
  };
}
