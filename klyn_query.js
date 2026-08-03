// KLYN query: CLI recall search over indexed AST blocks (ESM)
import { initializeVault, storeMemory, recall } from './index.js';
import path from 'node:path';
import fs from 'node:fs';

function hashWord(word) {
  let hash = 5381;
  for (let i = 0; i < word.length; i++) {
    hash = (hash * 33) ^ word.charCodeAt(i);
  }
  return Math.abs(hash);
}

function tokenize(text) {
  if (!text) return [];
  const words = text.match(/[A-Za-z0-9_]+/g) || [];
  const tokens = [];
  for (const w of words) {
    tokens.push(w.toLowerCase());
    const camel = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
    if (camel.length > 1) tokens.push(...camel);
  }
  return tokens;
}

function generateEmbedding(text) {
  const arr = new Float32Array(128);
  if (!text) return arr;
  const tokens = tokenize(text);
  for (const token of tokens) {
    const idx = hashWord(token) % 128;
    arr[idx] += 1.0;
  }
  let norm = 0.0;
  for (let i = 0; i < 128; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < 128; i++) arr[i] /= norm;
  }
  return arr;
}

function indexDir(dirPath) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const full = path.join(dirPath, file);
    if (fs.statSync(full).isFile() && (file.endsWith('.js') || file.endsWith('.ts'))) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      let currentBlock = [];
      let blockName = "global_scope";
      let blockIdx = 0;

      for (const line of lines) {
        if (line.includes('function') || line.includes('class') || line.includes('const ')) {
          if (currentBlock.length > 0) {
            const code = currentBlock.join('\n');
            storeMemory(`ast_${file}_${blockIdx++}`, "law_core_v1", generateEmbedding(code), Buffer.from(JSON.stringify({ file, blockName, code })), [file, "ast"]);
            currentBlock = [];
          }
          blockName = line.trim().slice(0, 40);
        }
        currentBlock.push(line);
      }
      if (currentBlock.length > 0) {
        const code = currentBlock.join('\n');
        storeMemory(`ast_${file}_${blockIdx++}`, "law_core_v1", generateEmbedding(code), Buffer.from(JSON.stringify({ file, blockName, code })), [file, "ast"]);
      }
    }
  }
}

const rootDir = import.meta.dirname;
initializeVault(path.join(rootDir, 'vault_data'));
indexDir(rootDir);

const query = process.argv[2] || "KlynCoreOS";
const embedding = generateEmbedding(query);
const results = recall(embedding, "law_core_v1", 3, 0.001);

console.log(`\n=== KLYN OS RECALL SEARCH: "${query}" ===`);
if (results.length === 0) {
  console.log("No matching AST blocks found.");
} else {
  results.forEach((r, i) => {
    try {
      const payload = JSON.parse(r.payload.toString('utf8'));
      console.log(`\n[Match #${i + 1}] Score: ${r.score.toFixed(4)} | File: ${payload.file}`);
      console.log(`Block: ${payload.blockName}`);
      console.log(`Preview: ${payload.code ? payload.code.trim().slice(0, 100) + '...' : ''}`);
    } catch (e) {
      console.log(`[Raw Payload]`, r.payload.toString('utf8').slice(0, 100));
    }
  });
}
