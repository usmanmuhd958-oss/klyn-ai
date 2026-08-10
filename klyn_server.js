// KLYN AI OS - Local Gateway (HTTP API server)
// NOTE: This file previously contained unresolved git merge-conflict markers that
// prevented it from parsing. The conflict was resolved to the working server
// implementation and converted to ESM to match package.json ("type": "module").
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { initializeVault, storeMemory, recall, memoryStats } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class KlynServerEngine {
  constructor(workDir) {
    this.workDir = workDir;
    initializeVault(path.join(workDir, 'vault_data'));
    console.log('[TRACE] loadIndexCache START');
this.loadIndexCache();
console.log('[TRACE] loadIndexCache END');
console.log('[KLYN] Background index disabled - worker mode pending');

  }

  hashWord(word) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) hash = (hash * 33) ^ word.charCodeAt(i);
    return Math.abs(hash);
  }

  tokenize(text) {
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

  generateEmbedding(text) {
    const arr = new Float32Array(128);
    if (!text) return arr;
    const tokens = this.tokenize(text);
    for (const token of tokens) {
      const idx = this.hashWord(token) % 128;
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


  recursiveIndex(dir, results = []) {
    const ignore = [
      "node_modules",
      ".git",
      "target",
      "vault_data",
      ".migration-backup",
      "backups",
      "dist"
    ];

    for (const item of fs.readdirSync(dir)) {
      if (ignore.includes(item)) continue;

      const full = path.join(dir, item);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        this.recursiveIndex(full, results);
      } else if (
        item.endsWith(".js") ||
        item.endsWith(".ts")
      ) {
        results.push(full);
      }
    }

    return results;
  }


  loadIndexCache() {
    try {
      const cacheFile = path.join(
        this.workDir,
        ".klyn-index-cache.json"
      );

      if (fs.existsSync(cacheFile)) {
        this.indexCache = JSON.parse(
          fs.readFileSync(cacheFile, "utf8")
        );
      } else {
        this.indexCache = {};
      }
    } catch {
      this.indexCache = {};
    }
  }

  saveIndexCache() {
    try {
      const cacheFile = path.join(
        this.workDir,
        ".klyn-index-cache.json"
      );

      fs.writeFileSync(
        cacheFile,
        JSON.stringify(this.indexCache || {}, null, 2)
      );
    } catch {}
  }

  indexCodebase() {
    const indexStart = Date.now();

    const files = this.recursiveIndex(this.workDir);

    console.log(
      `[KLYN INDEX] Files: ${files.length} Time: ${Date.now() - indexStart}ms`
    );
    for (const file of files) {
      const full = file;
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
              storeMemory(
  `srv_${file}_${blockIdx++}`,
  "law_core_v1",
  this.generateEmbedding(`${file} ${blockName} ${code}`),
  Buffer.from(JSON.stringify({ file, blockName, code })),
  [file, "ast"]
);
              currentBlock = [];
            }
            blockName = line.trim().slice(0, 40);
          }
          currentBlock.push(line);
        }
        if (currentBlock.length > 0) {
          const code = currentBlock.join('\n');
          storeMemory(
  `srv_${file}_${blockIdx++}`,
  "law_core_v1",
  this.generateEmbedding(`${file} ${blockName} ${code}`),
  Buffer.from(JSON.stringify({ file, blockName, code })),
  [file, "ast"]
);
        }
      }
    }
  }

  getEnrichedContext(query, topK = 3) {
    const embedding = this.generateEmbedding(query);
    const raw = recall(embedding, "law_core_v1", topK, 0.001);
    return raw.map(r => {
      try {
        return JSON.parse(r.payload.toString('utf8'));
      } catch (e) {
        return { raw: r.payload.toString('utf8') };
      }
    });
  }

  buildDependencyGraph() {
    const graph = {};
    const files = fs.readdirSync(this.workDir);
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        const content = fs.readFileSync(path.join(this.workDir, file), 'utf8');
        const imports = [];
        const matches = content.matchAll(/require\(['"]\.\/(.*?)['"]\)/g);
        for (const m of matches) {
          let dep = m[1];
          if (!dep.endsWith('.js')) dep += '.js';
          imports.push(dep);
        }
        graph[file] = imports;
      }
    }
    return graph;
  }

  analyzeImpact(targetFile) {
    const graph = this.buildDependencyGraph();
    const affectedFiles = [];
    for (const [file, deps] of Object.entries(graph)) {
      if (deps.includes(targetFile)) {
        affectedFiles.push(file);
      }
    }
    return {
      targetFile,
      dependentFiles: affectedFiles,
      impactLevel: affectedFiles.length > 0 ? "HIGH_RISK_DEPENDENCIES_FOUND" : "ISOLATED_CHANGE",
      graph
    };
  }

  verifyAndApplyPatch(filePath, newCode) {
    try {
      new vm.Script(newCode);
      const targetPath = path.join(this.workDir, filePath);
      fs.writeFileSync(targetPath, newCode, 'utf8');
      this.indexCodebase();
      return { success: true, message: "Patch verified via VM & applied safely to disk." };
    } catch (err) {
      return { success: false, error: err.message, type: "SYNTAX_VERIFICATION_FAILED" };
    }
  }

  executeAtomicTransaction(patches) {
    for (const p of patches) {
      try {
        new vm.Script(p.code);
      } catch (err) {
        return {
          success: false,
          status: "TRANSACTION_ABORTED",
          failedFile: p.file,
          error: err.message,
          rawCode: p.code,
          message: `Dry-run failed on ${p.file}. Zero files were modified.`
        };
      }
    }

    const appliedFiles = [];
    for (const p of patches) {
      const targetPath = path.join(this.workDir, p.file);
      fs.writeFileSync(targetPath, p.code, 'utf8');
      appliedFiles.push(p.file);
    }

    this.indexCodebase();
    return {
      success: true,
      status: "TRANSACTION_COMMITTED",
      modifiedFiles: appliedFiles,
      message: `Successfully verified and applied ${appliedFiles.length} files atomically.`
    };
  }

  autoHealPatch(file, brokenCode) {
    let healedCode = brokenCode;
    const openBraces = (brokenCode.match(/\{/g) || []).length;
    const closeBraces = (brokenCode.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      healedCode += '\n' + '}'.repeat(openBraces - closeBraces) + ';';
    }
    const openParens = (brokenCode.match(/\(/g) || []).length;
    const closeParens = (brokenCode.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      healedCode += ')';
    }

    try {
      new vm.Script(healedCode);
      const targetPath = path.join(this.workDir, file);
      fs.writeFileSync(targetPath, healedCode, 'utf8');
      this.indexCodebase();
      return {
        success: true,
        status: "AUTO_HEALED_AND_APPLIED",
        originalCode: brokenCode,
        healedCode: healedCode,
        message: "AST Self-Healing Engine successfully corrected syntax error."
      };
    } catch (err) {
      return {
        success: false,
        status: "HEAL_FAILED",
        error: err.message,
        message: "Code required complex LLM intervention beyond heuristic healing rules."
      };
    }
  }
}


const memoryDebug = () => ({
  status: "ok",
  message: "KLYN memory debug active"
});

const engine = new KlynServerEngine(__dirname);

function startServer(port) {
  const server = http.createServer((req, res) => {
    console.log('[HTTP]', req.method, req.url);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });

    req.on('end', () => {
      console.log('[HTTP REQUEST RECEIVED]', req.method, req.url);

      try {
        const payload = body ? JSON.parse(body) : {};

        if (req.method === 'GET' && req.url === '/v1/memory-status') {
          console.log('[MEMORY STATUS HIT]');
          const data = JSON.stringify(memoryStats());
          console.log('[MEMORY SIZE]', data.length);
          res.end(data);
        } else if (req.method === 'POST' && req.url === '/v1/context') {
          const contextBlocks = engine.getEnrichedContext(payload.prompt || '', 3);
          res.writeHead(200);
          res.end(JSON.stringify({
            status: "success",
            engine: "Klyn-AI-OS-ARM64",
            query: payload.prompt,
            retrievedContext: contextBlocks
          }));
        } else if (req.method === 'POST' && req.url === '/v1/patch') {
          const result = engine.verifyAndApplyPatch(payload.file, payload.code);
          if (result.success) {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "applied", details: result }));
          } else {
            res.writeHead(422);
            res.end(JSON.stringify({ status: "rejected", details: result }));
          }
        } else if (req.method === 'POST' && req.url === '/v1/transaction') {
          const result = engine.executeAtomicTransaction(payload.patches || []);
          if (result.success) {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "committed", details: result }));
          } else {
            res.writeHead(422);
            res.end(JSON.stringify({ status: "aborted", details: result }));
          }
        } else if (req.method === 'POST' && req.url === '/v1/heal') {
          const result = engine.autoHealPatch(payload.file, payload.code);
          if (result.success) {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "healed", details: result }));
          } else {
            res.writeHead(422);
            res.end(JSON.stringify({ status: "heal_failed", details: result }));
          }
        } else if (req.method === 'POST' && req.url === '/v1/impact') {
          const result = engine.analyzeImpact(payload.file || '');
          res.writeHead(200);
          res.end(JSON.stringify({ status: "analyzed", details: result }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ status: "online", system: "Klyn AI OS API Server v2.4 (Impact Analysis Engine)" }));
        }
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: "error", message: err.message }));
      }
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[KLYN WARN] Port ${port} occupied, attempting port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(`[KLYN ERROR]`, err);
    }
  });

  // Bind to 0.0.0.0 and honor the PORT injected by the host environment
  console.log('[TRACE] BEFORE LISTEN');
server.listen(port, '0.0.0.0', () => {
    console.log(`[KLYN SERVER] Local Gateway running on http://localhost:${port}`);
  });
}

startServer(Number(process.env.PORT) || 7860);
