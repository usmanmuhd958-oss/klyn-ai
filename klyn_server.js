// ============================================================================
// KLYN AI OS — Unified Production Gateway
// ============================================================================
// Phase 2 System Unification & Resilience Hardening:
//   - Consolidates the legacy api/gateway.ts (port 8000), api/metrics.ts
//     (port 9090) and the original server surface into ONE entrypoint. Every
//     REST endpoint keeps its original path, method and response shape.
//   - Authenticated /metrics and /v1/health/detail (Bearer token). Public
//     /v1/health stays minimal — process state is never exposed publicly.
//   - Graceful shutdown (SIGTERM/SIGINT): stop accepting, drain connections,
//     flush logs, exit 0 — with a bounded force-exit guard.
//   - Socket hardening: request/headers/keep-alive timeouts (Slowloris).
//   - Path confinement for every file-writing endpoint + 1 MiB body cap.
//   - Async, incremental file indexing: no O(repo) synchronous I/O in the
//     request path; a write re-indexes only the touched file (delta).
//   - Dependency injection: KlynServerEngine and createServer receive their
//     collaborators (auth, logger) from a composition root at the bottom.
//
// Runtime note: this file is plain ESM JavaScript (package.json "type":
// "module") and is run directly with `node klyn_server.js`. It intentionally
// does not import TypeScript modules; auth uses a timing-safe static-token
// check so the gateway has zero build-time coupling.
// ============================================================================

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath, parse as parseUrl } from 'node:url';
import { initializeVault, storeMemory, removeMemory, recall } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const GATEWAY_VERSION = '4.2.0';
const BODY_LIMIT = 1 << 20;          // 1 MiB — memory-exhaustion DoS guard
const REQUEST_TIMEOUT_MS = 30_000;   // Slowloris: kill idle request sockets
const HEADERS_TIMEOUT_MS = 10_000;   // Slowloris: stall during headers
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const FORCE_EXIT_MS = 10_000;        // bounded drain during shutdown
const SOURCE_EXTS = new Set(['.js', '.ts', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'target', 'genesis', '2.vault', '.klyn_runtime', 'vault_data']);

// ─── LOGGER (minimal, dependency-free; swap for kernel/logger.ts in TS layers)
function createLogger() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const order = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const min = order[level] ?? 30;
  const emit = (lvl, msg, meta) => {
    if (order[lvl] < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...(meta || {}) });
    if (order[lvl] >= 50) process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
  return {
    trace: (m, x) => emit('trace', m, x),
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
    flush: async () => {},
  };
}

// ─── AUTH (timing-safe bearer token; no TS import required) ─────────────────
// Policy:
//   - KLYN_ADMIN_TOKEN  — operator-provided token; required for /metrics,
//     /v1/health/detail and all file-writing endpoints.
//   - No env token      — a one-time token is generated and printed once at
//     boot so the operator can grab it (metrics stay protected).
//   - KLYN_DISABLE_AUTH=1 — legacy dev mode: write endpoints fall back to
//     open (with a loud warning); /metrics still requires the token.
function createAuthenticator(logger) {
  const disabled = process.env.KLYN_DISABLE_AUTH === '1';
  const envToken = process.env.KLYN_ADMIN_TOKEN;
  const staticToken = envToken || crypto.randomBytes(32).toString('hex');
  const tokenBuf = Buffer.from(staticToken, 'utf8');

  if (envToken) {
    logger.info('KLYN_ADMIN_TOKEN configured — protected endpoints require "Authorization: Bearer <token>"');
  } else {
    logger.warn('No KLYN_ADMIN_TOKEN set — generated one-time admin token (set the env var to make it stable): ' + staticToken);
  }
  if (disabled) {
    logger.warn('KLYN_DISABLE_AUTH=1 — file-writing endpoints are UNAUTHENTICATED (legacy dev mode). Do not use in production.');
  }

  const verify = (req) => {
    const header = req.headers.authorization || '';
    const candidate = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!candidate) return false;
    const a = Buffer.from(candidate, 'utf8');
    return a.length === tokenBuf.length && crypto.timingSafeEqual(a, tokenBuf);
  };

  return { verify, disabled };
}

// ─── ENGINE (async, incremental indexer) ────────────────────────────────────
class KlynServerEngine {
  constructor(workDir, deps = {}) {
    this.workDir = workDir;
    this.logger = deps.logger || null;
    // relFile -> number of memory blocks currently stored for that file
    this.fileBlockCounts = new Map();
    initializeVault(path.join(workDir, 'vault_data'));
  }

  async init() {
    await this.indexCodebase();
    this.logger?.info(`Indexed workspace ${this.workDir} (${this.fileBlockCounts.size} files)`);
  }

  // ── Indexing (non-blocking, recursive, blocklist-aware) ──────────────────
  async listSourceFiles(dir = this.workDir, base = '') {
    const out = [];
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.listSourceFiles(abs, rel)));
      } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
        out.push({ rel, abs });
      }
    }
    return out;
  }

  // Full boot scan — one-shot, async. Per-request paths never do this.
  async indexCodebase() {
    const files = await this.listSourceFiles();
    for (const { rel, abs } of files) {
      try {
        const content = await fs.promises.readFile(abs, 'utf8');
        this.indexFile(rel, content);
      } catch (err) {
        this.logger?.warn(`Index failed for ${rel}`, { error: err.message });
      }
    }
  }

  // Incremental delta: replace ONLY this file's blocks (remove stale, add new).
  indexFile(rel, content) {
    this.removeFileBlocks(rel);
    const lines = content.split('\n');
    let currentBlock = [];
    let blockName = 'global_scope';
    let blockIdx = 0;

    for (const line of lines) {
      if (line.includes('function') || line.includes('class') || line.includes('const ')) {
        if (currentBlock.length > 0) {
          this.storeBlock(rel, blockIdx++, blockName, currentBlock);
        }
        blockName = line.trim().slice(0, 40);
        currentBlock = [];
      }
      currentBlock.push(line);
    }
    if (currentBlock.length > 0) {
      this.storeBlock(rel, blockIdx++, blockName, currentBlock);
    }
    this.fileBlockCounts.set(rel, blockIdx);
  }

  storeBlock(rel, idx, blockName, blockLines) {
    const code = blockLines.join('\n');
    storeMemory(
      `srv_${rel}_${idx}`,
      'law_core_v1',
      this.generateEmbedding(code),
      Buffer.from(JSON.stringify({ file: rel, blockName, code })),
      [rel, 'ast']
    );
  }

  removeFileBlocks(rel) {
    const count = this.fileBlockCounts.get(rel) || 0;
    for (let i = 0; i < count; i++) {
      removeMemory(`srv_${rel}_${i}`);
    }
    this.fileBlockCounts.delete(rel);
  }

  // ── Hashing / embeddings (unchanged semantics) ────────────────────────────
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

  // ── Retrieval (unchanged) ─────────────────────────────────────────────────
  getEnrichedContext(query, topK = 3) {
    const embedding = this.generateEmbedding(query);
    const raw = recall(embedding, 'law_core_v1', topK, 0.001);
    return raw.map((r) => {
      try {
        return JSON.parse(r.payload.toString('utf8'));
      } catch (e) {
        return { raw: r.payload.toString('utf8') };
      }
    });
  }

  // ── Dependency graph (async, non-blocking reads) ──────────────────────────
  async buildDependencyGraph() {
    const graph = {};
    const files = await this.listSourceFiles();
    await Promise.all(
      files.map(async ({ rel, abs }) => {
        try {
          const content = await fs.promises.readFile(abs, 'utf8');
          const imports = [];
          const matches = content.matchAll(/require\(['"]\.\/(.*?)['"]\)/g);
          for (const m of matches) {
            let dep = m[1];
            if (!dep.endsWith('.js')) dep += '.js';
            imports.push(dep);
          }
          graph[rel] = imports;
        } catch {
          graph[rel] = [];
        }
      })
    );
    return graph;
  }

  async analyzeImpact(targetFile) {
    const graph = await this.buildDependencyGraph();
    const affectedFiles = [];
    for (const [file, deps] of Object.entries(graph)) {
      if (deps.includes(targetFile)) {
        affectedFiles.push(file);
      }
    }
    return {
      targetFile,
      dependentFiles: affectedFiles,
      impactLevel: affectedFiles.length > 0 ? 'HIGH_RISK_DEPENDENCIES_FOUND' : 'ISOLATED_CHANGE',
      graph,
    };
  }

  // ── Path confinement: reject any write that escapes the workspace root ────
  resolveSafePath(filePath) {
    const target = path.resolve(this.workDir, filePath);
    if (target !== this.workDir && !target.startsWith(this.workDir + path.sep)) {
      const err = new Error(`Path escapes workspace root: ${filePath}`);
      err.code = 'PATH_ESCAPE';
      throw err;
    }
    return target;
  }

  // ── Mutations (async, path-safe, incremental re-index) ────────────────────
  async verifyAndApplyPatch(filePath, newCode) {
    try {
      new vm.Script(newCode);
    } catch (err) {
      return { success: false, error: err.message, type: 'SYNTAX_VERIFICATION_FAILED' };
    }
    try {
      const targetPath = this.resolveSafePath(filePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, newCode, 'utf8');
      this.indexFile(filePath, newCode);
      return { success: true, message: 'Patch verified via VM & applied safely to disk.' };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        type: err.code === 'PATH_ESCAPE' ? 'PATH_ESCAPE' : 'WRITE_FAILED',
      };
    }
  }

  async executeAtomicTransaction(patches) {
    // Dry-run every patch first — zero files modified on any failure.
    for (const p of patches) {
      try {
        new vm.Script(p.code);
      } catch (err) {
        return {
          success: false,
          status: 'TRANSACTION_ABORTED',
          failedFile: p.file,
          error: err.message,
          rawCode: p.code,
          message: `Dry-run failed on ${p.file}. Zero files were modified.`,
        };
      }
      try {
        this.resolveSafePath(p.file);
      } catch (err) {
        return {
          success: false,
          status: 'TRANSACTION_ABORTED',
          failedFile: p.file,
          error: err.message,
          rawCode: p.code,
          message: `Dry-run failed on ${p.file}. Zero files were modified.`,
        };
      }
    }

    // Apply all, then re-index only the touched files (incremental deltas).
    const appliedFiles = [];
    for (const p of patches) {
      const targetPath = this.resolveSafePath(p.file);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, p.code, 'utf8');
      this.indexFile(p.file, p.code);
      appliedFiles.push(p.file);
    }

    return {
      success: true,
      status: 'TRANSACTION_COMMITTED',
      modifiedFiles: appliedFiles,
      message: `Successfully verified and applied ${appliedFiles.length} files atomically.`,
    };
  }

  async autoHealPatch(file, brokenCode) {
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
    } catch (err) {
      return {
        success: false,
        status: 'HEAL_FAILED',
        error: err.message,
        message: 'Code required complex LLM intervention beyond heuristic healing rules.',
      };
    }

    try {
      const targetPath = this.resolveSafePath(file);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, healedCode, 'utf8');
      this.indexFile(file, healedCode);
      return {
        success: true,
        status: 'AUTO_HEALED_AND_APPLIED',
        originalCode: brokenCode,
        healedCode: healedCode,
        message: 'AST Self-Healing Engine successfully corrected syntax error.',
      };
    } catch (err) {
      return {
        success: false,
        status: 'HEAL_FAILED',
        error: err.message,
        message: 'Code required complex LLM intervention beyond heuristic healing rules.',
      };
    }
  }
}

// ─── PHASE 9/10/11 HEADLESS API (TS engines, Bun runtime) ──────────────────
// The Phase 9/10/11 autonomous surface (api/router.ts) is TypeScript. Under
// plain Node this gateway intentionally stays dependency-free, so the TS
// engines are imported lazily ONLY when the process runs under Bun
// (bun klyn_server.js) — `node klyn_server.js` reports the surface as
// unavailable instead of crashing. The handler core is shared with the
// Express router.
const PHASE9_ROUTES = new Set([
  // Phase 9
  '/v1/graph/query', '/v1/system/metrics', '/v1/audit/verify', '/v1/autonomous/heal',
  // Phase 10 (self-hosting)
  '/v1/self/audit', '/v1/self/evolve', '/v1/self/manifest', '/v1/self/rollback',
  // Phase 11 (replication)
  '/v1/replicate/seed', '/v1/replicate/bootstrap',
  // Phase 12 (federation)
  '/v1/federation/sync',
  // Phase 13 (self-healing mesh)
  '/v1/mesh/quarantine', '/v1/mesh/heal',
]);
let phase9HandlerPromise = null;
let gatewayV2HandlerPromise = null;

function getPhase9Handler(logger) {
  if (typeof Bun === 'undefined') return null;
  if (!phase9HandlerPromise) {
    phase9HandlerPromise = import('./api/router.ts')
      .then((m) => m.createPhase9Handler({ repoRoot: __dirname }))
      .catch((err) => {
        logger.error('Phase 9 headless API failed to load', { error: err.message });
        return null;
      });
  }
  return phase9HandlerPromise;
}

// Phase 14: hardened multi-tenant gateway (signed JWT + RBAC). Its own
// handler serves the Phase 14 routes and delegates earlier-phase routes
// internally with an ephemeral token.
function getGatewayV2Handler(logger) {
  if (typeof Bun === 'undefined') return null;
  if (!gatewayV2HandlerPromise) {
    gatewayV2HandlerPromise = import('./api/gateway_v2.ts')
      .then((m) => m.createGatewayV2Handler({ repoRoot: __dirname }))
      .catch((err) => {
        logger.error('Phase 14 gateway failed to load', { error: err.message });
        return null;
      });
  }
  return gatewayV2HandlerPromise;
}

// ─── SERVER FACTORY ─────────────────────────────────────────────────────────
function createServer(engine, deps = {}) {
  const logger = deps.logger || createLogger();
  const auth = deps.auth || createAuthenticator(logger);

  const requestCounters = new Map(); // route -> count (exposed on /metrics)

  const respond = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // Metrics are ALWAYS authenticated — process state is never public.
  const requireAuth = (req, res) => {
    if (auth.verify(req)) return true;
    respond(res, 401, { status: 'unauthorized', message: 'Valid Bearer token required' });
    return false;
  };

  const requireWriteAuth = (req, res) => {
    if (auth.disabled) return true; // legacy dev mode (loud warning at boot)
    return requireAuth(req, res);
  };

  const handleRequest = async (req, res) => {
    // Request accounting (cheap, per-route counter for /metrics)
    const route = req.url || '/';
    requestCounters.set(route, (requestCounters.get(route) || 0) + 1);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');

    // ── GET: metrics (authenticated Prometheus-style) ──
    if (req.method === 'GET' && req.url === '/metrics') {
      if (!requireAuth(req, res)) return;
      const mem = process.memoryUsage();
      const lines = [
        '# HELP klyn_os_info Klyn OS build info',
        '# TYPE klyn_os_info gauge',
        `klyn_os_info{version="${GATEWAY_VERSION}"} 1`,
        '# HELP klyn_uptime_seconds Process uptime in seconds',
        '# TYPE klyn_uptime_seconds gauge',
        `klyn_uptime_seconds ${process.uptime()}`,
        '# HELP klyn_process_heap_bytes Heap usage in bytes',
        '# TYPE klyn_process_heap_bytes gauge',
        `klyn_process_heap_bytes{type="used"} ${mem.heapUsed}`,
        `klyn_process_heap_bytes{type="total"} ${mem.heapTotal}`,
        '# HELP klyn_process_rss_bytes Resident set size in bytes',
        '# TYPE klyn_process_rss_bytes gauge',
        `klyn_process_rss_bytes ${mem.rss}`,
        '# HELP klyn_http_requests_total HTTP requests by route',
        '# TYPE klyn_http_requests_total counter',
        ...[...requestCounters.entries()].map(([r, c]) => `klyn_http_requests_total{route="${r}"} ${c}`),
      ];
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(lines.join('\n') + '\n');
      return;
    }

    // ── GET: liveness (public, minimal — no process state) ──
    if (req.method === 'GET' && (req.url === '/v1/health' || req.url === '/health')) {
      respond(res, 200, { status: 'ok', service: 'klyn-ai-os', version: GATEWAY_VERSION });
      return;
    }

    // ── GET: full health detail (authenticated) ──
    if (req.method === 'GET' && req.url === '/v1/health/detail') {
      if (!requireAuth(req, res)) return;
      const mem = process.memoryUsage();
      respond(res, 200, {
        status: 'ok',
        service: 'klyn-ai-os',
        version: GATEWAY_VERSION,
        uptime: process.uptime(),
        memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
        loadAvg: os.loadavg(),
        freeMem: os.freemem(),
      });
      return;
    }

    // ── PHASE 9/10/11: GET surface (authenticated headless API) ──
    // Pathname matching so query-string routes (rewind?seq=, sync?since=,
    // causality?a=&b=) reach the shared handler with their full URL intact.
    const pathname = parseUrl(req.url || '/', true).pathname;
    const PHASE_GET_ROUTES = new Set([
      '/v1/system/metrics', '/v1/audit/verify',
      '/v1/self/manifest',
      '/v1/temporal/now', '/v1/temporal/rewind', '/v1/temporal/causality',
      '/v1/replicate/sync',
      '/v1/federation/nodes', '/v1/benchmarks/run',
      '/v1/mesh/topology',
    ]);
    // Phase 14 hardened surface (signed JWT): audit export, tenant registry,
    // Prometheus metrics, OTel traces, artifact plan.
    const PHASE14_GET_ROUTES = new Set([
      '/v1/audit/export', '/v1/gateway/tenants',
      '/v1/metrics/prometheus', '/v1/traces', '/v1/artifacts/plan',
    ]);
    if (req.method === 'GET' && (PHASE_GET_ROUTES.has(pathname) || PHASE14_GET_ROUTES.has(pathname))) {
      // New Phase 14 routes use the signed-JWT gateway; earlier-phase routes
      // keep their legacy static-token surface (zero breaking changes).
      const handlerPromise = PHASE14_GET_ROUTES.has(pathname) ? getGatewayV2Handler(logger) : getPhase9Handler(logger);
      if (!handlerPromise) {
        respond(res, 503, { status: 'error', message: 'Phase 9-14 headless API requires the Bun runtime (bun klyn_server.js)' });
        return;
      }
      const handler = await handlerPromise;
      if (!handler) {
        respond(res, 503, { status: 'error', message: 'Phase 9-14 headless API failed to initialize' });
        return;
      }
      const result = await handler({ method: 'GET', url: req.url, headers: req.headers });
      respond(res, result.status, result.body);
      return;
    }

    // ── POST routes with bounded body collection ──
    if (req.method !== 'POST') {
      respond(res, 404, { status: 'not_found' });
      return;
    }

    let body = '';
    let aborted = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (aborted) return;
      body += chunk;
      if (body.length > BODY_LIMIT) {
        aborted = true;
        respond(res, 413, { status: 'error', message: 'Payload too large' });
        req.destroy();
      }
    });

    // A client that disconnects mid-body emits 'error' on the request stream;
    // without a listener that is an unhandled 'error' event and kills the process.
    req.on('error', (err) => {
      aborted = true;
      logger.warn('Request stream error', { url: req.url, error: err.message });
      if (!res.headersSent) respond(res, 400, { status: 'error', message: 'Request stream error' });
    });

    req.on('end', async () => {
      if (aborted) return;
      try {
        const payload = body ? JSON.parse(body) : {};
        const url = req.url || '';

        if (url === '/v1/context') {
          const contextBlocks = engine.getEnrichedContext(payload.prompt || '', 3);
          respond(res, 200, {
            status: 'success',
            engine: 'Klyn-AI-OS-ARM64',
            query: payload.prompt,
            retrievedContext: contextBlocks,
          });
        } else if (url === '/v1/patch') {
          if (!requireWriteAuth(req, res)) return;
          const result = await engine.verifyAndApplyPatch(payload.file, payload.code);
          if (result.success) {
            respond(res, 200, { status: 'applied', details: result });
          } else {
            respond(res, 422, { status: 'rejected', details: result });
          }
        } else if (url === '/v1/transaction') {
          if (!requireWriteAuth(req, res)) return;
          const result = await engine.executeAtomicTransaction(payload.patches || []);
          if (result.success) {
            respond(res, 200, { status: 'committed', details: result });
          } else {
            respond(res, 422, { status: 'aborted', details: result });
          }
        } else if (url === '/v1/heal') {
          if (!requireWriteAuth(req, res)) return;
          const result = await engine.autoHealPatch(payload.file, payload.code);
          if (result.success) {
            respond(res, 200, { status: 'healed', details: result });
          } else {
            respond(res, 422, { status: 'heal_failed', details: result });
          }
        } else if (url === '/v1/impact') {
          const result = await engine.analyzeImpact(payload.file || '');
          respond(res, 200, { status: 'analyzed', details: result });
        } else if (PHASE9_ROUTES.has(url)) {
          // ── PHASE 9/10/11: POST surface (authenticated headless API) ──
          const phase9 = getPhase9Handler(logger);
          if (!phase9) {
            respond(res, 503, { status: 'error', message: 'Phase 9/10/11 headless API requires the Bun runtime (bun klyn_server.js)' });
            return;
          }
          const handler = await phase9;
          if (!handler) {
            respond(res, 503, { status: 'error', message: 'Phase 9/10/11 headless API failed to initialize' });
            return;
          }
          const result = await handler({ method: 'POST', url, headers: req.headers, body: payload });
          respond(res, result.status, result.body);
        } else if (url === '/v1/gateway/token') {
          // ── PHASE 14: token issuance through the signed-JWT gateway ──
          const gatewayV2 = getGatewayV2Handler(logger);
          if (!gatewayV2) {
            respond(res, 503, { status: 'error', message: 'Phase 14 gateway requires the Bun runtime (bun klyn_server.js)' });
            return;
          }
          const handler = await gatewayV2;
          if (!handler) {
            respond(res, 503, { status: 'error', message: 'Phase 14 gateway failed to initialize' });
            return;
          }
          const result = await handler({ method: 'POST', url, headers: req.headers, body: payload });
          respond(res, result.status, result.body);
        } else {
          respond(res, 200, {
            status: 'online',
            system: 'Klyn AI OS API Server v2.4 (Impact Analysis Engine)',
          });
        }
      } catch (err) {
        // A malformed body is the client's fault (400); anything else is an
        // engine/IO failure and must surface as 500 with a server-side log —
        // never reported to the caller as a bad request.
        if (err instanceof SyntaxError) {
          logger.warn('Malformed JSON body', { url: req.url, error: err.message });
          respond(res, 400, { status: 'error', message: err.message });
        } else {
          logger.error('Request handler failed', { url: req.url, error: err.message, stack: err.stack });
          respond(res, 500, { status: 'error', message: 'Internal server error' });
        }
      }
    });
  };

  // Any rejection escaping the handler is logged and answered with a 500 —
  // an unanswered request would otherwise hang until the socket times out.
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error('Unhandled request error', { url: req.url, error: err?.message, stack: err?.stack });
      if (res.headersSent) res.end();
      else respond(res, 500, { status: 'error', message: 'Internal server error' });
    });
  });

  // ── Socket hardening (Slowloris) ──────────────────────────────────────────
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  // Track live sockets so shutdown can drain them.
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — draining connections and shutting down`);

    const forceTimer = setTimeout(() => {
      logger.warn('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceTimer.unref();

    // Stop accepting new connections; close() resolves once all sockets close.
    server.close(() => {
      clearTimeout(forceTimer);
      logger.info('HTTP server closed');
      finishShutdown();
    });

    // Destroy idle sockets immediately; give in-flight requests 1s to finish.
    for (const socket of sockets) {
      if (socket.writableLength === 0) socket.destroy();
    }
    setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, 1000).unref();
  };

  const finishShutdown = async () => {
    try {
      await logger.flush();
    } catch (err) {
      process.stderr.write(`[KLYN Gateway] Log flush failed during shutdown: ${err.message}\n`);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  return server;
}

// ─── BOOT ───────────────────────────────────────────────────────────────────
function startServer(port) {
  const server = createServer(engine, { logger });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} occupied, attempting port ${port + 1}...`);
      startServer(port + 1);
    } else {
      // The gateway has no listening socket — stay noisy and exit non-zero so
      // the supervisor restarts instead of keeping a dead process alive.
      logger.error('Server error — gateway cannot serve traffic', { error: err.message, stack: err.stack });
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    logger.info(`KLYN Unified Gateway running on http://localhost:${port}`);
  });
}

// Composition root: wire concrete collaborators here, then boot.
const logger = createLogger();
const engine = new KlynServerEngine(__dirname, { logger });
await engine.init();
startServer(Number(process.env.PORT) || 7860);
