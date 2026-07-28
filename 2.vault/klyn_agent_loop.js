const { initializeVault, storeMemory, recall } = require('./index.js');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

class KlynAgentEngine {
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    initializeVault(vaultPath);
  }

  hashWord(word) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 33) ^ word.charCodeAt(i);
    }
    return Math.abs(hash);
  }

  tokenize(text) {
    if (!text) return [];
    const words = text.match(/[A-Za-z0-9_]+/g) || [];
    const tokens = [];

    for (const w of words) {
      const lower = w.toLowerCase();
      tokens.push(lower);
      const camelSplit = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
      if (camelSplit.length > 1) tokens.push(...camelSplit);
    }
    return tokens;
  }

  generateEmbedding(text) {
    const arr = new Float32Array(128);
    if (!text || text.length === 0) return arr;

    const tokens = this.tokenize(text);
    if (tokens.length === 0) return arr;

    for (const token of tokens) {
      const idx = this.hashWord(token) % 128;
      arr[idx] += 1.0;
    }

    let norm = 0.0;
    for (let i = 0; i < 128; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < 128; i++) arr[i] = arr[i] / norm;
    }

    return arr;
  }

  indexExecutionResult(filePath, stdout, stderr, exitCode) {
    const filename = path.basename(filePath);
    const status = exitCode === 0 ? "SUCCESS" : "FAILURE";
    const logContent = `File: ${filename}\nStatus: ${status}\nExitCode: ${exitCode}\nStdout: ${stdout}\nStderr: ${stderr}`;
    const embedding = this.generateEmbedding(logContent);
    const id = `exec_${filename}_${Date.now()}`;
    const payload = Buffer.from(JSON.stringify({ file: filename, status, stdout, stderr, exitCode }));

    try {
      storeMemory(id, "law_core_v1", embedding, payload, [filename, "execution_log", status.toLowerCase()]);
      console.log(`[KLYN AGENT] Autonomous Execution State Indexed -> ${filename} (${status})`);
    } catch (e) {}
  }

  executeAndIndex(filePath) {
    if (!fs.existsSync(filePath)) return;
    const filename = path.basename(filePath);
    if (!filename.endsWith('.js') || filename.includes('daemon') || filename.includes('agent')) return;

    console.log(`[KLYN AGENT] Running background execution sandbox on: ${filename}...`);
    exec(`node ${filePath}`, { timeout: 4000 }, (error, stdout, stderr) => {
      const exitCode = error ? (error.code || 1) : 0;
      this.indexExecutionResult(filePath, stdout, stderr, exitCode);
    });
  }

  searchExecutionLogs(query, topK = 2) {
    const queryEmbedding = this.generateEmbedding(query);
    const rawResults = recall(queryEmbedding, "law_core_v1", topK, 0.001);

    return rawResults.map(res => {
      let decodedPayload = {};
      try {
        decodedPayload = JSON.parse(res.payload.toString('utf8'));
      } catch (e) {
        decodedPayload = { raw: res.payload.toString('utf8') };
      }
      return {
        score: Number(res.score.toFixed(4)),
        file: decodedPayload.file || 'unknown',
        status: decodedPayload.status || 'unknown',
        stdout: decodedPayload.stdout ? decodedPayload.stdout.trim() : '',
        stderr: decodedPayload.stderr ? decodedPayload.stderr.trim() : ''
      };
    });
  }
}

const agent = new KlynAgentEngine(path.join(__dirname, 'vault_data'));

console.log("=== KLYN AI OS: AUTONOMOUS EXECUTION ENGINE TEST ===");
agent.executeAndIndex(path.join(__dirname, 'test-vault.js'));

setTimeout(() => {
  console.log("\n=== RECALLING EXECUTION MEMORY FROM KLYN VAULT ===");
  const logs = agent.searchExecutionLogs("SUCCESS test-vault.js", 2);
  console.dir(logs, { depth: null });
}, 1500);

// Self-healed by Klyn AI OS on 2026-07-28T14:23:22.562Z
export const selfHealed = true;
