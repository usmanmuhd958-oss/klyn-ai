// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// ============================================================
// KLYN AI OS — Kernel Health & Control API v1.0.0
//
// Endpoints:
//   GET  /health          → liveness probe (Kubernetes/Fly.io)
//   GET  /ready           → readiness probe
//   GET  /status          → full kernel status JSON
//   GET  /metrics         → metrics snapshot
//   GET  /agents          → all agent statuses
//   POST /agents/:id/start
//   POST /agents/:id/stop
//   POST /agents/:id/restart
//   POST /shutdown        → graceful kernel shutdown
//
// Security:
//   - Bearer token authentication (KLYN_API_TOKEN env var)
//   - Rate limiting (50 req/min per IP)
//   - Request ID tracing on every response
//   - No external dependencies (http module only)
// ============================================================

'use strict';

const http   = require('http');
const crypto = require('crypto');

// ─── RATE LIMITER ────────────────────────────────────────────
class RateLimiter {
  [key: string]: any;
    #windowMs;
    #maxReq;
    #buckets;   // ip → { count, resetAt }

    constructor(windowMs = 60_000, maxReq = 50) {
        this.#windowMs = windowMs;
        this.#maxReq   = maxReq;
        this.#buckets  = new Map();

        // Cleanup stale entries every 5 min
        setInterval(() => {
            const now = Date.now();
            for (const [ip, b] of this.#buckets) {
                if (now > b.resetAt) this.#buckets.delete(ip);
            }
        }, 300_000).unref();
    }

    check(ip) {
        const now = Date.now();
        let bucket = this.#buckets.get(ip);

        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + this.#windowMs };
            this.#buckets.set(ip, bucket);
        }

        bucket.count++;
        return {
            allowed:     bucket.count <= this.#maxReq,
            remaining:   Math.max(0, this.#maxReq - bucket.count),
            resetAt:     bucket.resetAt,
        };
    }
}

// ─── HEALTH API SERVER ───────────────────────────────────────
class HealthApiServer {
  [key: string]: any;
    #server;
    #orchestrator;
    #logger;
    #apiToken;
    #rateLimiter;
    #port;

    constructor(orchestrator, logger, options: any = {}) {
        this.#orchestrator = orchestrator;
        this.#logger       = logger;
        this.#apiToken     = process.env.KLYN_API_TOKEN || null;
        this.#port         = options.port || 9000;
        this.#rateLimiter  = new RateLimiter(60_000, options.rateLimit || 50);

        if (!this.#apiToken) {
            logger.warn('KLYN_API_TOKEN not set — Health API is UNAUTHENTICATED');
        }

        this.#server = http.createServer((req, res) =>
            this.#handleRequest(req, res)
        );
    }

    listen() {
        return new Promise((resolve, reject) => {
            this.#server.listen(this.#port, '127.0.0.1', () => {
                this.#logger.info(
                    `Health API listening on http://127.0.0.1:${this.#port}`
                );
                // @ts-ignore
                resolve();
            });
            this.#server.once('error', reject);
        });
    }

    close() {
        return new Promise((resolve) => this.#server.close(resolve));
    }

    // ── REQUEST HANDLER ──────────────────────────────────────
    async #handleRequest(req, res) {
        const requestId = crypto.randomUUID();
        const ip        = req.socket.remoteAddress || 'unknown';
        const start     = Date.now();

        // Rate limiting
        const rl = this.#rateLimiter.check(ip);
        (res as any).setHeader('X-Request-Id',       requestId);
        (res as any).setHeader('X-RateLimit-Remaining', rl.remaining);

        if (!rl.allowed) {
            return this.#send(res, 429, { error: 'Too Many Requests' });
        }

        // Auth check (skip for /health — needed for load balancer probes)
        const skipAuth = req.url === '/health' || req.url === '/ready';

        if (!skipAuth && this.#apiToken) {
            const authHeader = req.headers.authorization || '';
            const token      = authHeader.replace(/^Bearer\s+/i, '');

            if (!token || !this.#constantTimeEqual(token, this.#apiToken)) {
                return this.#send(res, 401, { error: 'Unauthorized' });
            }
        }

        // Router
        try {
            await this.#route(req, res);
        } catch (err) {
            this.#logger.error('Health API handler error', { error: err.message, requestId });
            this.#send(res, 500, { error: 'Internal Server Error' });
        }

        this.#logger.debug(`${req.method} ${req.url} → ${(res as any).statusCode} (${Date.now() - start}ms)`, {
            requestId, ip,
        });
    }

    async #route(req, res) {
        const url    = req.url.split('?')[0];
        const method = req.method.toUpperCase();

        // GET /health
        if (method === 'GET' && url === '/health') {
            return this.#send(res, 200, {
                status: 'ok',
                ts:     Date.now(),
                pid:    process.pid,
            });
        }

        // GET /ready
        if (method === 'GET' && url === '/ready') {
            const ready = this.#orchestrator.isReady();
            return this.#send(res, ready ? 200 : 503, {
                ready,
                ts: Date.now(),
            });
        }

        // GET /status
        if (method === 'GET' && url === '/status') {
            return this.#send(res, 200, this.#orchestrator.getStatus());
        }

        // GET /agents
        if (method === 'GET' && url === '/agents') {
            const status = this.#orchestrator.getStatus();
            return this.#send(res, 200, (status as any).processes);
        }

        // POST /agents/:id/start|stop|restart
        const agentMatch = url.match(/^\/agents\/([^/]+)\/(start|stop|restart)$/);
        if (method === 'POST' && agentMatch) {
            const [, id, action] = agentMatch;
            try {
                if (action === 'start') {
                    await this.#orchestrator.startAgent(id);
                } else if (action === 'stop') {
                    await this.#orchestrator.stopAgent(id, true);
                } else {
                    await this.#orchestrator.restartAgent(id);
                }
                return this.#send(res, 200, { ok: true, agent: id, action });
            } catch (err) {
                return this.#send(res, 400, { ok: false, error: err.message });
            }
        }

        // POST /shutdown
        if (method === 'POST' && url === '/shutdown') {
            this.#send(res, 202, { ok: true, message: 'Shutdown accepted' });
            setImmediate(() => {
                this.#orchestrator.emit('shutdown-request', { source: 'api' });
                // Use the mailbox to send shutdown
                const mb = this.#orchestrator.getMailbox('kernel');
                mb?.send({
                    type:    'kernel:shutdown',
                    from:    'health-api',
                    to:      'kernel',
                    payload: { reason: 'api_request' },
                }).catch(() => {});
            });
            return;
        }

        return this.#send(res, 404, { error: 'Not Found', url });
    }

    // ── UTILITIES ────────────────────────────────────────────
    #send(res, status, body) {
        const json = JSON.stringify(body, null, 2);
        (res as any).writeHead(status, {
            'Content-Type':  'application/json',
            'Cache-Control': 'no-store',
            'X-Powered-By':  'KLYN-AI-OS',
        });
        (res as any).end(json);
    }

    #constantTimeEqual(a, b) {
        if (a.length !== b.length) return false;
        try {
            return crypto.timingSafeEqual(
                Buffer.from(a, 'utf8'),
                Buffer.from(b, 'utf8')
            );
        } catch {
            return false;
        }
    }
}

module.exports = { HealthApiServer };


export {};
