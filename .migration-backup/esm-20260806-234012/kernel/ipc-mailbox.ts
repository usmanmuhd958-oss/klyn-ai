// ============================================================
// KLYN AI OS — Non-Blocking IPC Mailbox Architecture
// Version: 2.0.0
//
// Architecture:
//   MailboxRouter  (1)  → coordinates all named mailboxes
//   Mailbox        (N)  → per-agent/service message channel
//   MessageQueue   (1 per Mailbox) → priority-aware, TTL-enforced
//
// Features:
//   - Three-level priority queue (HIGH / NORMAL / LOW)
//   - TTL enforcement — expired messages auto-DLQ
//   - Non-blocking poll loop via setImmediate chaining
//   - Request-reply correlation (await reply within timeout)
//   - Dead-letter queue (DLQ) with configurable capacity
//   - Persistent queue backed by filesystem (append-only JSON lines)
//   - Mailbox stats for observability
//   - Zero external dependencies
// ============================================================

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// ─── CONSTANTS ───────────────────────────────────────────────
const PRIORITY = Object.freeze({
    HIGH:   1,
    NORMAL: 5,
    LOW:    10,
});

const MESSAGE_STATUS = Object.freeze({
    PENDING:     'PENDING',
    PROCESSING:  'PROCESSING',
    DELIVERED:   'DELIVERED',
    FAILED:      'FAILED',
    EXPIRED:     'EXPIRED',
    DEAD_LETTER: 'DEAD_LETTER',
});

const DEFAULT_TTL_MS        = 60_000;    // 1 min
const DEFAULT_POLL_INTERVAL = 100;       // ms between drain cycles
const DLQ_MAX_SIZE          = 500;       // max DLQ entries per mailbox
const REPLY_TIMEOUT_MS      = 30_000;    // default reply timeout

// ─── MESSAGE FACTORY ─────────────────────────────────────────
function createMessage(fields = {}) {
    return {
        // @ts-ignore
        id:          fields.id          || crypto.randomUUID(),
        // @ts-ignore
        type:        fields.type        || 'generic',
        // @ts-ignore
        from:        fields.from        || 'kernel',
        // @ts-ignore
        to:          fields.to          || 'broadcast',
        // @ts-ignore
        priority:    fields.priority    ?? PRIORITY.NORMAL,
        // @ts-ignore
        payload:     fields.payload     ?? {},
        // @ts-ignore
        ttl:         fields.ttl         ?? DEFAULT_TTL_MS,
        // @ts-ignore
        createdAt:   fields.createdAt   || Date.now(),
        // @ts-ignore
        replyTo:     fields.replyTo     || null,     // message id for reply correlation
        // @ts-ignore
        correlationId: fields.correlationId || null, // for request-reply pattern
        status:      MESSAGE_STATUS.PENDING,
        attempts:    0,
    };
}

// ─── PRIORITY QUEUE ──────────────────────────────────────────
// Three-bucket priority queue: O(1) enqueue, O(1) dequeue for HIGH priority,
// O(n) worst-case across all buckets (n is typically tiny — agent mailboxes).
class PriorityQueue {
    #high;
    #normal;
    #low;
    #size;

    constructor() {
        this.#high   = [];
        this.#normal = [];
        this.#low    = [];
        this.#size   = 0;
    }

    enqueue(message) {
        switch (message.priority) {
            case PRIORITY.HIGH:   this.#high.push(message);   break;
            case PRIORITY.LOW:    this.#low.push(message);    break;
            default:              this.#normal.push(message);  break;
        }
        this.#size++;
    }

    dequeue() {
        let msg;

        if (this.#high.length > 0) {
            msg = this.#high.shift();
        } else if (this.#normal.length > 0) {
            msg = this.#normal.shift();
        } else if (this.#low.length > 0) {
            msg = this.#low.shift();
        } else {
            return null;
        }

        this.#size--;
        return msg;
    }

    // Drain all expired messages to DLQ, return array of expired
    drainExpired() {
        const now     = Date.now();
        const expired = [];

        const check = (bucket) => {
            // In-place filter — avoid allocation when no expiry
            let writeIdx = 0;
            for (let i = 0; i < bucket.length; i++) {
                const msg = bucket[i];
                if (now - msg.createdAt > msg.ttl) {
                    expired.push(msg);
                    this.#size--;
                } else {
                    bucket[writeIdx++] = msg;
                }
            }
            bucket.length = writeIdx;
        };

        check(this.#high);
        check(this.#normal);
        check(this.#low);

        return expired;
    }

    peek() {
        return this.#high[0] || this.#normal[0] || this.#low[0] || null;
    }

    get size()  { return this.#size; }
    isEmpty()   { return this.#size === 0; }

    toArray() {
        return [...this.#high, ...this.#normal, ...this.#low];
    }
}

// ─── MAILBOX ─────────────────────────────────────────────────
class Mailbox extends EventEmitter {
    #name;
    #queue;
    #dlq;
    #handlers;        // type → Set<handler fn>
    #replyWaiters;    // correlationId → { resolve, reject, timer }
    #pollInterval;
    #pollTimer;
    #running;
    #persistPath;
    #persistStream;
    #stats;

    constructor(name = 'default', options = {}) {
        super();
        this.setMaxListeners(500);

        this.#name          = name;
        this.#queue         = new PriorityQueue();
        this.#dlq           = [];
        this.#handlers      = new Map();
        this.#replyWaiters  = new Map();
        // @ts-ignore
        this.#pollInterval  = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
        this.#running       = false;
        // @ts-ignore
        this.#persistPath   = options.persistPath || null;
        this.#persistStream = null;

        this.#stats = {
            enqueued:   0,
            delivered:  0,
            expired:    0,
            dlq:        0,
            errors:     0,
            replysSent: 0,
            replysRecv: 0,
        };

        if (this.#persistPath) {
            this.#openPersistStream();
            this.#loadPersistedMessages();
        }
    }

    get name()  { return this.#name; }
    get size()  { return this.#queue.size; }
    get dlqSize() { return this.#dlq.length; }

    // ── HANDLER REGISTRATION ─────────────────────────────────
    /**
     * Register a handler for a message type.
     * Multiple handlers per type are supported.
     *
     * @param {string}   type
     * @param {Function} handler - async (message) => void
     */
    on(type, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(`Mailbox.on: handler for '${type}' must be a function`);
        }
        if (!this.#handlers.has(type)) {
            this.#handlers.set(type, new Set());
        }
        this.#handlers.get(type).add(handler);
        return this;
    }

    off(type, handler) {
        this.#handlers.get(type)?.delete(handler);
        return this;
    }

    // ── SEND ─────────────────────────────────────────────────
    /**
     * Enqueue a message for delivery.
     * Returns the created message (with id assigned).
     *
     * @param {object} fields
     * @returns {object} message
     */
    async send(fields) {
        const message = createMessage({
            ...fields,
            from: fields.from || this.#name,
        });

        this.#queue.enqueue(message);
        this.#stats.enqueued++;

        if (this.#persistStream) {
            this.#persist(message);
        }

        return message;
    }

    // ── REQUEST-REPLY ────────────────────────────────────────
    /**
     * Send a message and await a correlated reply.
     *
     * @param {object} fields
     * @param {number} [timeoutMs]
     * @returns {Promise<object>} reply payload
     */
    async request(fields, timeoutMs = REPLY_TIMEOUT_MS) {
        const correlationId = crypto.randomUUID();

        const message = await this.send({
            ...fields,
            correlationId,
        });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#replyWaiters.delete(correlationId);
                reject(new Error(
                    `Mailbox request timed out after ${timeoutMs}ms ` +
                    `(type: ${message.type}, id: ${message.id})`
                ));
            }, timeoutMs);

            this.#replyWaiters.set(correlationId, { resolve, reject, timer });
        });
    }

    // ── REPLY ────────────────────────────────────────────────
    /**
     * Send a reply to a received message.
     *
     * @param {object} originalMessage  - The message being replied to
     * @param {any}    payload          - Reply data
     */
    async reply(originalMessage, payload) {
        if (!originalMessage?.correlationId) return;

        await this.send({
            type:          `${originalMessage.type}:reply`,
            to:             originalMessage.from,
            from:           this.#name,
            correlationId:  originalMessage.correlationId,
            replyTo:        originalMessage.id,
            payload,
            priority:       PRIORITY.HIGH,   // Replies are always high priority
            ttl:            30_000,
        });

        this.#stats.replysSent++;
    }

    // ── POLL LOOP ────────────────────────────────────────────
    start() {
        if (this.#running) return;
        this.#running = true;
        this.#schedulePoll();
    }

    stop() {
        this.#running = false;
        if (this.#pollTimer) {
            clearTimeout(this.#pollTimer);
            this.#pollTimer = null;
        }
    }

    #schedulePoll() {
        if (!this.#running) return;

        this.#pollTimer = setTimeout(() => {
            this.#drainCycle().finally(() => {
                this.#schedulePoll();
            });
        }, this.#pollInterval);

        // Don't keep the process alive for mailbox polling alone
        this.#pollTimer.unref?.();
    }

    async #drainCycle() {
        // 1. Evict expired messages → DLQ
        const expired = this.#queue.drainExpired();
        for (const msg of expired) {
            msg.status = MESSAGE_STATUS.EXPIRED;
            this.#pushDLQ(msg, 'ttl_expired');
            this.#stats.expired++;
        }

        // 2. Drain up to 32 messages per cycle (back-pressure safety)
        let processed = 0;
        const BATCH_LIMIT = 32;

        while (!this.#queue.isEmpty() && processed < BATCH_LIMIT) {
            const message = this.#queue.dequeue();
            if (!message) break;

            processed++;
            message.status   = MESSAGE_STATUS.PROCESSING;
            message.attempts++;

            try {
                await this.#dispatch(message);
                message.status = MESSAGE_STATUS.DELIVERED;
                this.#stats.delivered++;
            } catch (err) {
                message.status = MESSAGE_STATUS.FAILED;
                this.#stats.errors++;
                this.#pushDLQ(message, err.message || 'dispatch_error');

                this.emit('dispatch-error', { message, error: err });
            }
        }
    }

    async #dispatch(message) {
        // Check for reply routing first
        if (message.correlationId && this.#replyWaiters.has(message.correlationId)) {
            const waiter = this.#replyWaiters.get(message.correlationId);
            this.#replyWaiters.delete(message.correlationId);
            clearTimeout(waiter.timer);
            waiter.resolve(message.payload);
            this.#stats.replysRecv++;
            return;
        }

        // Find handlers
        const handlers = this.#handlers.get(message.type);

        if (!handlers || handlers.size === 0) {
            // Emit for wildcard catch
            if (this.#handlers.has('*')) {
                for (const h of this.#handlers.get('*')) {
                    await h(message);
                }
                return;
            }

            // No handler — DLQ with reason
            throw new Error(`No handler registered for message type: '${message.type}'`);
        }

        // Invoke all handlers concurrently (fan-out)
        await Promise.all([...handlers].map((h) => h(message)));
    }

    // ── DEAD LETTER QUEUE ────────────────────────────────────
    #pushDLQ(message, reason) {
        if (this.#dlq.length >= DLQ_MAX_SIZE) {
            // Evict oldest
            this.#dlq.shift();
        }

        this.#dlq.push({
            message,
            reason,
            deadAt: Date.now(),
        });

        this.#stats.dlq++;
        this.emit('dead-letter', { message, reason });
    }

    getDLQ() {
        return [...this.#dlq];
    }

    clearDLQ() {
        this.#dlq = [];
    }

    // ── PERSISTENCE ──────────────────────────────────────────
    #openPersistStream() {
        try {
            const dir = path.dirname(this.#persistPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
            }

            this.#persistStream = fs.createWriteStream(this.#persistPath, {
                flags:    'a',
                encoding: 'utf8',
                mode:     0o640,
            });

            this.#persistStream.on('error', (err) => {
                process.stderr.write(`[Mailbox:${this.#name}] Persist error: ${err.message}\n`);
                this.#persistStream = null;
            });
        } catch (err) {
            process.stderr.write(`[Mailbox:${this.#name}] Cannot open persist path: ${err.message}\n`);
        }
    }

    #persist(message) {
        if (!this.#persistStream?.writable) return;
        try {
            this.#persistStream.write(JSON.stringify(message) + '\n');
        } catch (_) {}
    }

    #loadPersistedMessages() {
        if (!fs.existsSync(this.#persistPath)) return;

        try {
            const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n');
            let loaded  = 0;
            const now   = Date.now();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    // Skip expired messages
                    if (now - msg.createdAt > msg.ttl) continue;
                    // Reset to PENDING for reprocessing
                    msg.status = MESSAGE_STATUS.PENDING;
                    this.#queue.enqueue(msg);
                    loaded++;
                } catch (_) {}
            }

            if (loaded > 0) {
                process.stdout.write(`[Mailbox:${this.#name}] Recovered ${loaded} persisted messages\n`);
            }

            // Truncate the file — messages are now in memory
            fs.truncateSync(this.#persistPath, 0);

        } catch (err) {
            process.stderr.write(`[Mailbox:${this.#name}] Persist load error: ${err.message}\n`);
        }
    }

    // ── STATS ────────────────────────────────────────────────
    getStats() {
        return {
            name:         this.#name,
            running:      this.#running,
            queueDepth:   this.#queue.size,
            dlqDepth:     this.#dlq.length,
            handlers:     Object.fromEntries(
                [...this.#handlers.entries()].map(([k, v]) => [k, v.size])
            ),
            pendingReplies: this.#replyWaiters.size,
            stats:        { ...this.#stats },
        };
    }

    // ── CLEANUP ──────────────────────────────────────────────
    close() {
        this.stop();

        // Reject all pending reply waiters
        for (const [id, waiter] of this.#replyWaiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('Mailbox closed'));
        }
        this.#replyWaiters.clear();

        // Close persist stream
        if (this.#persistStream) {
            try { this.#persistStream.end(); } catch (_) {}
            this.#persistStream = null;
        }
    }
}

// ─── MAILBOX ROUTER ──────────────────────────────────────────
class MailboxRouter extends EventEmitter {
    #mailboxes;     // name → Mailbox
    #mailboxDir;    // base directory for persisted queues
    #cleanupTimer;
    #cleanupIntervalMs;

    constructor(mailboxDir, options = {}) {
        super();

        this.#mailboxes         = new Map();
        this.#mailboxDir        = mailboxDir;
        // @ts-ignore
        this.#cleanupIntervalMs = options.cleanupIntervalMs ?? 3_600_000; // 1 hr

        // Ensure mailbox directory exists
        if (mailboxDir && !fs.existsSync(mailboxDir)) {
            try {
                fs.mkdirSync(mailboxDir, { recursive: true, mode: 0o750 });
            } catch (err) {
                process.stderr.write(`[MailboxRouter] Cannot create mailbox dir: ${err.message}\n`);
            }
        }
    }

    /**
     * Register a named mailbox.
     *
     * @param {string} name
     * @param {object} [options]
     * @returns {Mailbox}
     */
    register(name, options = {}) {
        if (this.#mailboxes.has(name)) {
            return this.#mailboxes.get(name);
        }

        const persistPath = this.#mailboxDir
            ? path.join(this.#mailboxDir, `${name}.queue`)
            : null;

        const mailbox = new Mailbox(name, {
            // @ts-ignore
            pollInterval: options.pollInterval ?? DEFAULT_POLL_INTERVAL,
            persistPath,
        });

        // Bubble dead-letter events to router
        mailbox.on('dead-letter', (data) => {
            this.emit('dead-letter', { mailbox: name, ...data });
        });

        mailbox.on('dispatch-error', (data) => {
            this.emit('dispatch-error', { mailbox: name, ...data });
        });

        this.#mailboxes.set(name, mailbox);
        return mailbox;
    }

    /**
     * Get a registered mailbox by name.
     * @param {string} name
     * @returns {Mailbox|undefined}
     */
    get(name) {
        return this.#mailboxes.get(name);
    }

    /**
     * Route a message from one mailbox to another.
     * Creates target mailbox if it doesn't exist.
     *
     * @param {object} message
     */
    async route(message) {
        const target = message.to;

        if (target === 'broadcast') {
            // Fan out to all registered mailboxes except source
            await Promise.all(
                [...this.#mailboxes.values()]
                    .filter((mb) => mb.name !== message.from)
                    .map((mb) => mb.send(message))
            );
            return;
        }

        let mailbox = this.#mailboxes.get(target);
        if (!mailbox) {
            // Auto-register on first contact
            mailbox = this.register(target);
        }

        await mailbox.send(message);
    }

    // Start polling on all registered mailboxes
    startAll() {
        for (const mailbox of this.#mailboxes.values()) {
            mailbox.start();
        }

        // Periodic DLQ cleanup
        this.#cleanupTimer = setInterval(() => {
            this.#runCleanup();
        }, this.#cleanupIntervalMs);

        this.#cleanupTimer.unref?.();
    }

    stopAll() {
        for (const mailbox of this.#mailboxes.values()) {
            mailbox.stop();
        }

        if (this.#cleanupTimer) {
            clearInterval(this.#cleanupTimer);
            this.#cleanupTimer = null;
        }
    }

    #runCleanup() {
        for (const [name, mailbox] of this.#mailboxes) {
            const dlq = mailbox.getDLQ();
            if (dlq.length > DLQ_MAX_SIZE * 0.9) {
                process.stdout.write(
                    `[MailboxRouter] DLQ for '${name}' at ${dlq.length} — clearing old entries\n`
                );
                mailbox.clearDLQ();
            }
        }
    }

    getStats() {
        const stats = {};
        for (const [name, mailbox] of this.#mailboxes) {
            stats[name] = mailbox.getStats();
        }
        return stats;
    }

    close() {
        this.stopAll();
        for (const mailbox of this.#mailboxes.values()) {
            mailbox.close();
        }
        this.#mailboxes.clear();
    }
}

// ─── EXPORTS ─────────────────────────────────────────────────
export { MailboxRouter, Mailbox, PriorityQueue, createMessage, PRIORITY, MESSAGE_STATUS, DEFAULT_TTL_MS, REPLY_TIMEOUT_MS };
