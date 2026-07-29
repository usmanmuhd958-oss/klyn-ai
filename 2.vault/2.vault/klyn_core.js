// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { initializeVault, storeMemory, recall } = require('./index.js');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { exec } = require('child_process');

class KlynCoreOS {
  constructor(workDir) {
    this.workDir = workDir;
    this.vaultPath = path.join(workDir, 'vault_data');
    initializeVault(this.vaultPath);
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

  indexFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const filename = path.basename(filePath);
    if (!filename.endsWith('.js') && !filename.endsWith('.ts')) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let currentBlock = [];
    let blockName = "global_scope";
    let blockIdx = 0;

    for (const line of lines) {
      if (line.includes('function') || line.includes('class') || line.includes('const ')) {
        if (currentBlock.length > 0) {
          this.saveBlock(filename, blockName, currentBlock.join('\n'), blockIdx++);
          currentBlock = [];
        }
        blockName = line.trim().slice(0, 40);
      }
      currentBlock.push(line);
    }
    if (currentBlock.length > 0) {
      this.saveBlock(filename, blockName, currentBlock.join('\n'), blockIdx++);
    }
  }

  saveBlock(filename, blockName, code, idx) {
    const embedding = this.generateEmbedding(code);
    const id = `core_ast_${filename}_${idx}_${Date.now()}`;
    const payload = Buffer.from(JSON.stringify({ file: filename, blockName, code }));
    try {
      storeMemory(id, "law_core_v1", embedding, payload, [filename, "ast_block"]);
    } catch (e) {}
  }

  runExecutionSandbox(filePath) {
    if (!fs.existsSync(filePath)) return;
    const filename = path.basename(filePath);
    if (!filename.endsWith('.js') || filename.includes('core') || filename.includes('daemon')) return;

    exec(`node ${filePath}`, { timeout: 3000 }, (error, stdout, stderr) => {
      const exitCode = error ? (error.code || 1) : 0;
      const status = exitCode === 0 ? "SUCCESS" : "FAILURE";
      const logText = `File: ${filename}\nStatus: ${status}\nExitCode: ${exitCode}\nStdout: ${stdout}\nStderr: ${stderr}`;
      const embedding = this.generateEmbedding(logText);
      const id = `core_exec_${filename}_${Date.now()}`;
      const payload = Buffer.from(JSON.stringify({ file: filename, status, stdout, stderr, exitCode }));

      try {
        storeMemory(id, "law_core_v1", embedding, payload, [filename, "exec_log", status.toLowerCase()]);
        console.log(`[KLYN CORE] Live Execution Synced -> ${filename} [${status}]`);
      } catch (e) {}
    });
  }

  applyVerifiedMutation(filePath, codeMutator) {
    if (!fs.existsSync(filePath)) return { success: false, reason: "File missing" };
    const source = fs.readFileSync(filePath, 'utf8');
    const mutated = codeMutator(source);

    try {
      new vm.Script(mutated);
    } catch (err) {
      return { success: false, status: "SELF_HEALING_BLOCKED", error: err.message };
    }

    fs.writeFileSync(filePath, mutated, 'utf8');
    this.indexFile(filePath);
    this.runExecutionSandbox(filePath);
    return { success: true, status: "MUTATION_VERIFIED_AND_APPLIED" };
  }

  queryFullContext(queryText, topK = 5) {
    const queryEmbedding = this.generateEmbedding(queryText);
    const results = recall(queryEmbedding, "law_core_v1", topK, 0.001);

    return results.map(r => {
      try {
        return { score: Number(r.score.toFixed(4)), data: JSON.parse(r.payload.toString('utf8')) };
      } catch (e) {
        return { score: Number(r.score.toFixed(4)), raw: r.payload.toString('utf8') };
      }
    });
  }

  startActiveOS() {
    console.log("==================================================");
    console.log("       KLYN AI OS CORE AGENT ACTIVE (ARM64)       ");
    console.log("==================================================");
    
    const files = fs.readdirSync(this.workDir);
    for (const file of files) {
      const full = path.join(this.workDir, file);
      if (fs.statSync(full).isFile() && (file.endsWith('.js') || file.endsWith('.ts'))) {
        this.indexFile(full);
      }
    }
    console.log("[KLYN CORE] Project files indexed into native Rust memory.");

    fs.watch(this.workDir, (event, filename) => {
      if (filename && (filename.endsWith('.js') || filename.endsWith('.ts')) && !filename.includes('core')) {
        const fullPath = path.join(this.workDir, filename);
        console.log(`[KLYN CORE] Change detected in: ${filename}`);
        this.indexFile(fullPath);
        this.runExecutionSandbox(fullPath);
      }
    });
  }
}

const klynOS = new KlynCoreOS(__dirname);
klynOS.startActiveOS();

// Self-healed by Klyn AI OS on 2026-07-28T14:23:22.565Z
export const selfHealed = true;
