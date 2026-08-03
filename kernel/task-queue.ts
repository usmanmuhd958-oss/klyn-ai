import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// ============================================================
// KLYN AI OS — Persistent Task Queue Engine v2.0.0
//
// Architecture:
//   TaskQueue         — core engine, public API surface
//   TaskPriorityQueue — in-memory O(1) priority dispatch
//   TaskStore         — atomic JSONL filesystem persistence
//
// Public API (called by HTTP route + CLI):
//   queue.enqueue(title, type, payload, options)  → Task
//   queue.getStatus()                             → StatusSnapshot
//   queue.getPending()                            → Task[]
//   queue.getRunning()                            → Task[]
//   queue.getDLQ()                                → DLQEntry[]
//   queue.cancel(taskId)                          → Task
//   queue.register(type, handlerFn)               → this
//   queue.start()                                 → void
//   queue.stop()                                  → void
//
// Persistence:
//   runtime/tasks/tasks-YYYY-MM-DD.jsonl          — event log
//   runtime/tasks/state.json                      — current snapshot
//   runtime/tasks/dlq.jsonl                       — dead letter log
//
// Guarantees:
//   - Atomic writes via tmp → rename pattern
//   - Idempotency via user-supplied or auto-generated key
//   - TTL enforcement — expired tasks never dispatched
//   - Exponential backoff on retry (full-jitter, AWS algorithm)
//   - Zero external dependencies
// ============================================================

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// ─── PULL BACKOFF FROM KERNEL — SAFE FALLBACK ─────────────────
let computeBackoff;
try {
    computeBackoff = require('./backoff').computeBackoff;
} catch (_) {
    // Inline fallback so task-queue works standalone
    computeBackoff = (attempt, baseMs = 500, maxMs = 60_000) => {
        const cap = Math.min(maxMs, baseMs * Math.pow(2, attempt));
        return Math.floor(Math.random() * cap);
    };
}

// ─── CONSTANTS ───────────────────────────────────────────────
const TASK_PRIORITY = Object.freeze({
    CRITICAL:   0,
    HIGH:       1,
    NORMAL:     2,
    LOW:        3,
    BACKGROUND: 4,
});

const PRIORITY_NAMES = Object.freeze(
    Object.fromEntries(Object.entries(TASK_PRIORITY).map(([k, v]) => [v, k]))
);

const TASK_STATE = Object.freeze({
    QUEUED:    'QUEUED',
    RUNNING:   'RUNNING',
    DONE:      'DONE',
    FAILED:    'FAILED',
    CANCELLED: 'CANCELLED',
    DLQ:       'DLQ',
    EXPIRED:   'EXPIRED',
});

const DEFAULTS = Object.freeze({
    MAX_RETRIES:      3,
    RETRY_BASE_MS:    500,
    RETRY_MAX_MS:     60_000,
    TASK_TTL_MS:      24 * 60 * 60 * 1000,   // 24 hours
    CONCURRENCY:      3,
    POLL_INTERVAL_MS: 150,
    FLUSH_INTERVAL_MS: 4_000,
    DLQ_MAX:          1_000,
    STATE_SAVE_EVERY: 25,   // Save state.json every N completions
});

// ─── TASK FACTORY ────────────────────────────────────────────
/**
 * Create a normalised task object.
 *
 * @param {string}  title    — Human-readable task description
 * @param {string}  type     — Handler type key (e.g. 'agent:plan')
 * @param {object}  payload  — Arbitrary data for the handler
 * @param {object}  options  — Priority, retries, ttl, idempotencyKey, etc.
 */
function createTask(title, type, payload = {}, options = {}) {
    if (!title || typeof title !== 'string') {
        throw new TypeError('Task title must be a non-empty string');
    }
    if (!type || typeof type !== 'string') {
        throw new TypeError('Task type must be a non-empty string');
    }

    const now = Date.now();

    return Object.freeze({
        // @ts-ignore
        id:             options.id             || crypto.randomUUID(),
        // @ts-ignore
        idempotencyKey: options.idempotencyKey || null,
        title:          title.trim().slice(0, 500),
        type,
        // @ts-ignore
        priority:       options.priority       ?? TASK_PRIORITY.NORMAL,
        payload:        { ...payload },
        state:          TASK_STATE.QUEUED,
        attempts:       0,
        // @ts-ignore
        maxRetries:     options.maxRetries     ?? DEFAULTS.MAX_RETRIES,
        // @ts-ignore
        retryBaseMs:    options.retryBaseMs    ?? DEFAULTS.RETRY_BASE_MS,
        createdAt:      now,
        // @ts-ignore
        scheduledAt:    options.scheduledAt    || now,
        // @ts-ignore
        ttl:            options.ttl            || DEFAULTS.TASK_TTL_MS,
        // @ts-ignore
        source:         options.source         || 'api',
        // @ts-ignore
        tags:           options.tags           || {},
        runAt:          null,
        doneAt:         null,
        result:         null,
        error:          null,
    });
}

// ─── TASK STORE (FILESYSTEM) ──────────────────────────────────
class TaskStore {
    #dir;
    #writeBuffer;
    #dlqBuffer;
    #flushTimer;
    #completionCount;
    #stateCache;

    constructor(dir) {
        this.#dir             = dir;
        this.#writeBuffer     = [];
        this.#dlqBuffer       = [];
        this.#flushTimer      = null;
        this.#completionCount = 0;
        this.#stateCache      = null;

        this.#ensureDir();
    }

    // ── WRITE EVENT ──────────────────────────────────────────
    writeEvent(event, task) {
        this.#writeBuffer.push({
            event,
            taskId:  task.id,
            type:    task.type,
            title:   task.title,
            state:   task.state,
            ts:      Date.now(),
            task,
        });
    }

    writeDLQ(task, reason) {
        this.#dlqBuffer.push({
            taskId: task.id,
            type:   task.type,
            title:  task.title,
            reason,
            task,
            deadAt: Date.now(),
        });
    }

    // ── START / STOP FLUSH LOOP ───────────────────────────────
    startFlush(intervalMs = DEFAULTS.FLUSH_INTERVAL_MS) {
        if (this.#flushTimer) return;
        this.#flushTimer = setInterval(() => this.flush(), intervalMs);
        this.#flushTimer.unref?.();
    }

    stopFlush() {
        if (this.#flushTimer) {
            clearInterval(this.#flushTimer);
            this.#flushTimer = null;
        }
        this.flush();   // Final flush
    }

    // ── FLUSH TO DISK ────────────────────────────────────────
    flush() {
        this.#flushEvents();
        this.#flushDLQ();
    }

    #flushEvents() {
        if (!this.#writeBuffer.length) return;

        const batch = this.#writeBuffer.splice(0);
        const lines = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';

        try {
            fs.appendFileSync(this.#todayPath(), lines, { mode: 0o640 });
        } catch (err) {
            process.stderr.write(`[TaskStore] Flush error: ${err.message}\n`);
            // Re-queue last 200 to avoid memory explosion
            this.#writeBuffer.unshift(...batch.slice(-200));
        }
    }

    #flushDLQ() {
        if (!this.#dlqBuffer.length) return;

        const batch = this.#dlqBuffer.splice(0);
        const lines = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';

        try {
            fs.appendFileSync(this.#dlqPath(), lines, { mode: 0o640 });
        } catch (err) {
            process.stderr.write(`[TaskStore] DLQ flush error: ${err.message}\n`);
        }
    }

    // ── STATE SNAPSHOT ────────────────────────────────────────
    // Atomic write: write to .tmp then rename — crash-safe
    saveState(snapshot) {
        const statePath = path.join(this.#dir, 'state.json');
        const tmpPath   = statePath + '.tmp';

        try {
            fs.writeFileSync(
                tmpPath,
                JSON.stringify(snapshot, null, 2),
                { mode: 0o640 }
            );
            fs.renameSync(tmpPath, statePath);
        } catch (err) {
            process.stderr.write(`[TaskStore] State save error: ${err.message}\n`);
        }
    }

    // ── RECOVERY ─────────────────────────────────────────────
    // Load QUEUED tasks from today's event log that were never completed
    recover() {
        const storePath = this.#todayPath();
        if (!fs.existsSync(storePath)) return [];

        const recovered = new Map();   // taskId → task
        const terminal  = new Set();   // taskIds in terminal state

        try {
            const lines = fs.readFileSync(storePath, 'utf8').split('\n');
            const now   = Date.now();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);
                    const task  = entry.task;
                    if (!task?.id) continue;

                    const terminalStates = new Set([
                        TASK_STATE.DONE,
                        TASK_STATE.CANCELLED,
                        TASK_STATE.DLQ,
                        TASK_STATE.EXPIRED,
                    ]);

                    if (terminalStates.has(task.state)) {
                        terminal.add(task.id);
                        recovered.delete(task.id);
                    } else if (!terminal.has(task.id)) {
                        // Not expired
                        if (now - task.createdAt < task.ttl) {
                            // Reset to QUEUED so we re-attempt
                            recovered.set(task.id, {
                                ...task,
                                state:       TASK_STATE.QUEUED,
                                scheduledAt: now,   // immediate retry
                            });
                        }
                    }
                } catch (_) {}
            }
        } catch (err) {
            process.stderr.write(`[TaskStore] Recovery error: ${err.message}\n`);
        }

        return [...recovered.values()];
    }

    // ── PATHS ─────────────────────────────────────────────────
    #todayPath() {
        const date = new Date().toISOString().slice(0, 10);
        return path.join(this.#dir, `tasks-${date}.jsonl`);
    }

    #dlqPath() {
        return path.join(this.#dir, 'dlq.jsonl');
    }

    #ensureDir() {
        if (!fs.existsSync(this.#dir)) {
            fs.mkdirSync(this.#dir, { recursive: true, mode: 0o750 });
        }
    }

    // Prune log files older than maxDays
    prune(maxDays = 7) {
        try {
            const files = fs.readdirSync(this.#dir)
                .filter((f) => f.startsWith('tasks-') && f.endsWith('.jsonl'))
                .sort()
                .reverse();

            const toDelete = files.slice(maxDays);
            for (const f of toDelete) {
                fs.unlinkSync(path.join(this.#dir, f));
            }
        } catch (_) {}
    }
}

// ─── PRIORITY QUEUE ──────────────────────────────────────────
class InternalPriorityQueue {
    // Five buckets, one per priority level
    #b;
    #size;

    constructor() {
        this.#b    = [[], [], [], [], []];
        this.#size = 0;
    }

    enqueue(task) {
        const level = Math.min(
            Math.max(task.priority ?? TASK_PRIORITY.NORMAL, 0),
            this.#b.length - 1
        );
        this.#b[level].push(task);
        this.#size++;
    }

    // Return highest-priority task whose scheduledAt <= now
    dequeue() {
        const now = Date.now();
        for (const bucket of this.#b) {
            for (let i = 0; i < bucket.length; i++) {
                if (bucket[i].scheduledAt <= now) {
                    const [task] = bucket.splice(i, 1);
                    this.#size--;
                    return task;
                }
            }
        }
        return null;
    }

    // Remove and return all tasks past their TTL
    evictExpired() {
        const now     = Date.now();
        const expired = [];

        for (const bucket of this.#b) {
            let w = 0;
            for (let i = 0; i < bucket.length; i++) {
                if (now - bucket[i].createdAt > bucket[i].ttl) {
                    expired.push(bucket[i]);
                    this.#size--;
                } else {
                    bucket[w++] = bucket[i];
                }
            }
            bucket.length = w;
        }

        return expired;
    }

    hasIdempotencyKey(key) {
        return this.#b.some((bucket) =>
            bucket.some((t) => t.idempotencyKey === key)
        );
    }

    toArray() {
        return this.#b.flat();
    }

    get size() { return this.#size; }
    isEmpty()  { return this.#size === 0; }
}

// ─── TASK QUEUE (PUBLIC API) ──────────────────────────────────
class TaskQueue extends EventEmitter {
    // Private state
    #queue;               // InternalPriorityQueue
    #running;             // Map<taskId, Task>
    #dlq;                 // DLQEntry[]
    #handlers;            // Map<type, async (task) => result>
    #idempotencySet;      // Set<key>
    #store;               // TaskStore
    #concurrency;
    #active;
    #pollTimer;
    #logger;
    #stats;

    constructor(tasksDir, options = {}) {
        super();
        this.setMaxListeners(500);

        if (!tasksDir) throw new Error('TaskQueue: tasksDir is required');

        this.#queue          = new InternalPriorityQueue();
        this.#running        = new Map();
        this.#dlq            = [];
        this.#handlers       = new Map();
        this.#idempotencySet = new Set();
        this.#store          = new TaskStore(tasksDir);
        // @ts-ignore
        this.#concurrency    = options.concurrency   ?? DEFAULTS.CONCURRENCY;
        this.#active         = false;
        this.#pollTimer      = null;
        // @ts-ignore
        this.#logger         = options.logger        || null;

        this.#stats = {
            enqueued:   0,
            completed:  0,
            failed:     0,
            retried:    0,
            cancelled:  0,
            dlq:        0,
            expired:    0,
        };

        // Recover persisted tasks from today's log
        this.#recoverTasks();
    }

    // ─────────────────────────────────────────────────────────
    // PUBLIC API — called by HTTP routes and CLI
    // ─────────────────────────────────────────────────────────

    /**
     * Enqueue a new task.
     *
     * @param {string} title    — Human description shown in dashboard
     * @param {string} type     — Handler type key
     * @param {object} payload  — Data for the handler
     * @param {object} options  — { priority, maxRetries, ttl, idempotencyKey, tags, source }
     * @returns {object} The created task (frozen)
     */
    enqueue(title, type, payload = {}, options = {}) {
        // Resolve priority from string or number
        // @ts-ignore
        if (typeof options.priority === 'string') {
            // @ts-ignore
            options.priority = TASK_PRIORITY[options.priority.toUpperCase()]
                ?? TASK_PRIORITY.NORMAL;
        }

        // Idempotency guard
        // @ts-ignore
        if (options.idempotencyKey) {
            // @ts-ignore
            if (this.#idempotencySet.has(options.idempotencyKey)) {
                this.#logger?.debug(
                    // @ts-ignore
                    `Task deduplicated: ${options.idempotencyKey}`
                );
                return null;
            }
            // @ts-ignore
            this.#idempotencySet.add(options.idempotencyKey);
        }

        const task = createTask(title, type, payload, options);

        this.#queue.enqueue(task);
        this.#stats.enqueued++;

        this.#store.writeEvent('enqueue', task);
        this.emit('task:enqueued', task);

        this.#logger?.info(`Task enqueued: [${task.id.slice(0, 8)}] ${task.title}`, {
            type:     task.type,
            priority: PRIORITY_NAMES[task.priority] || task.priority,
        });

        return task;
    }

    /**
     * Register a handler function for a task type.
     * Use '*' as a catch-all handler.
     *
     * @param {string}   type
     * @param {Function} handler  async (task) => result
     */
    register(type, handler) {
        if (typeof handler !== 'function') {
            throw new TypeError(
                `TaskQueue.register: handler for '${type}' must be a function`
            );
        }
        this.#handlers.set(type, handler);
        this.#logger?.debug(`Handler registered: ${type}`);
        return this;
    }

    /**
     * Cancel a QUEUED task by ID.
     * Throws if task is already RUNNING or not found.
     */
    cancel(taskId) {
        const tasks = this.#queue.toArray();
        const task  = tasks.find((t) => t.id === taskId);

        if (!task) {
            throw new Error(
                `Task '${taskId}' not found in queue (may be running or completed)`
            );
        }

        const cancelled = { ...task, state: TASK_STATE.CANCELLED, doneAt: Date.now() };
        this.#store.writeEvent('cancel', cancelled);
        this.#stats.cancelled++;
        this.emit('task:cancelled', cancelled);

        // Remove from idempotency set
        if (task.idempotencyKey) {
            this.#idempotencySet.delete(task.idempotencyKey);
        }

        this.#logger?.info(`Task cancelled: ${taskId}`);
        return cancelled;
    }

    // ── START / STOP ──────────────────────────────────────────
    start() {
        if (this.#active) return;
        this.#active = true;

        this.#store.startFlush();

        this.#pollTimer = setInterval(
            () => this.#drainCycle(),
            DEFAULTS.POLL_INTERVAL_MS
        );
        this.#pollTimer.unref?.();

        // Daily pruning
        setInterval(() => this.#store.prune(7), 24 * 60 * 60 * 1000).unref?.();

        this.#logger?.info('Task queue started', {
            concurrency: this.#concurrency,
            pending:     this.#queue.size,
            handlers:    [...this.#handlers.keys()],
        });

        this.emit('queue:started', { pending: this.#queue.size });
    }

    stop() {
        this.#active = false;

        if (this.#pollTimer) {
            clearInterval(this.#pollTimer);
            this.#pollTimer = null;
        }

        this.#store.stopFlush();
        this.#logger?.info('Task queue stopped');
    }

    // ─────────────────────────────────────────────────────────
    // STATUS / READ API
    // ─────────────────────────────────────────────────────────

    getStatus() {
        return {
            active:      this.#active,
            concurrency: this.#concurrency,
            queue: {
                pending: this.#queue.size,
                running: this.#running.size,
                dlq:     this.#dlq.length,
            },
            stats:    { ...this.#stats },
            handlers: [...this.#handlers.keys()],
        };
    }

    getPending() {
        return this.#queue.toArray().map((t) => this.#safeTask(t));
    }

    getRunning() {
        return [...this.#running.values()].map((t) => this.#safeTask(t));
    }

    getDLQ() {
        return [...this.#dlq];
    }

    clearDLQ() {
        const count  = this.#dlq.length;
        this.#dlq    = [];
        this.#logger?.info(`DLQ cleared: ${count} entries removed`);
        return count;
    }

    getStats() {
        return { ...this.#stats };
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE — DRAIN CYCLE
    // ─────────────────────────────────────────────────────────

    #drainCycle() {
        if (!this.#active) return;

        // Evict expired tasks
        const expired = this.#queue.evictExpired();
        for (const task of expired) {
            const exp = { ...task, state: TASK_STATE.EXPIRED, doneAt: Date.now() };
            this.#store.writeEvent('expire', exp);
            this.#stats.expired++;
            this.emit('task:expired', exp);
            if (task.idempotencyKey) this.#idempotencySet.delete(task.idempotencyKey);
        }

        // Fill concurrency slots
        while (
            this.#active &&
            this.#running.size < this.#concurrency &&
            !this.#queue.isEmpty()
        ) {
            const task = this.#queue.dequeue();
            if (!task) break;
            // Fire-and-forget — errors handled inside
            this.#executeTask(task).catch(() => {});
        }
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE — TASK EXECUTION
    // ─────────────────────────────────────────────────────────

    async #executeTask(rawTask) {
        const task = {
            ...rawTask,
            state:    TASK_STATE.RUNNING,
            runAt:    Date.now(),
            attempts: rawTask.attempts + 1,
        };

        this.#running.set(task.id, task);
        this.#store.writeEvent('start', task);
        this.emit('task:start', task);

        this.#logger?.debug(
            `Task starting: [${task.id.slice(0, 8)}] ${task.title} ` +
            `(attempt ${task.attempts}/${task.maxRetries + 1})`
        );

        // Resolve handler
        const handler = this.#handlers.get(task.type)
            || this.#handlers.get('*');

        if (!handler) {
            this.#running.delete(task.id);
            const failed = {
                ...task,
                state: TASK_STATE.DLQ,
                error: `No handler registered for type: '${task.type}'`,
                doneAt: Date.now(),
            };
            this.#pushDLQ(failed, 'no_handler');
            return;
        }

        try {
            const result = await handler(task);

            const done = {
                ...task,
                state:  TASK_STATE.DONE,
                result: result ?? null,
                error:  null,
                doneAt: Date.now(),
            };

            this.#running.delete(task.id);
            if (task.idempotencyKey) this.#idempotencySet.delete(task.idempotencyKey);

            this.#store.writeEvent('done', done);
            this.#stats.completed++;

            this.emit('task:done', done);

            this.#logger?.info(
                `Task complete: [${done.id.slice(0, 8)}] ${done.title} ` +
                `(${done.doneAt - done.runAt}ms)`
            );

        } catch (err) {
            this.#running.delete(task.id);
            await this.#handleFailure(task, err);
        }
    }

    async #handleFailure(task, err) {
        const errorMessage = err?.message || String(err);
        const canRetry     = task.attempts <= task.maxRetries;

        if (canRetry) {
            const delayMs = computeBackoff(
                task.attempts - 1,
                task.retryBaseMs,
                DEFAULTS.RETRY_MAX_MS
            );

            const retryTask = {
                ...task,
                state:       TASK_STATE.QUEUED,
                error:       errorMessage,
                scheduledAt: Date.now() + delayMs,
            };

            this.#queue.enqueue(retryTask);
            this.#stats.retried++;

            this.#store.writeEvent('retry', {
                ...retryTask,
                retryDelayMs: delayMs,
            });

            this.emit('task:retry', {
                task:    retryTask,
                attempt: task.attempts,
                delayMs,
                error:   errorMessage,
            });

            this.#logger?.warn(
                `Task retry ${task.attempts}/${task.maxRetries}: ` +
                `[${task.id.slice(0, 8)}] ${task.title} — ` +
                `retrying in ${delayMs}ms`,
                { error: errorMessage }
            );

        } else {
            // Exhausted — send to DLQ
            const failed = {
                ...task,
                state:  TASK_STATE.DLQ,
                error:  errorMessage,
                doneAt: Date.now(),
            };

            if (task.idempotencyKey) this.#idempotencySet.delete(task.idempotencyKey);

            this.#pushDLQ(failed, 'exhausted');
            this.#stats.failed++;

            this.emit('task:failed', { task: failed, error: errorMessage });

            this.#logger?.error(
                `Task exhausted: [${failed.id.slice(0, 8)}] ${failed.title}`,
                { attempts: task.attempts, error: errorMessage }
            );
        }
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE — DLQ
    // ─────────────────────────────────────────────────────────

    #pushDLQ(task, reason) {
        if (this.#dlq.length >= DEFAULTS.DLQ_MAX) {
            this.#dlq.shift();
        }

        const entry = { task, reason, deadAt: Date.now() };
        this.#dlq.push(entry);
        this.#store.writeDLQ(task, reason);
        this.#stats.dlq++;

        this.emit('task:dlq', entry);
    }

    // ─────────────────────────────────────────────────────────
    // PRIVATE — RECOVERY
    // ─────────────────────────────────────────────────────────

    #recoverTasks() {
        const tasks = this.#store.recover();
        for (const task of tasks) {
            this.#queue.enqueue(task);
            if (task.idempotencyKey) {
                this.#idempotencySet.add(task.idempotencyKey);
            }
        }

        if (tasks.length > 0) {
            this.#logger?.info(`Task queue recovered ${tasks.length} persisted task(s)`);
        }
    }

    // Return a safe serialisable copy of a task
    #safeTask(task) {
        return {
            id:          task.id,
            title:       task.title,
            type:        task.type,
            priority:    PRIORITY_NAMES[task.priority] || task.priority,
            state:       task.state,
            attempts:    task.attempts,
            maxRetries:  task.maxRetries,
            createdAt:   task.createdAt,
            scheduledAt: task.scheduledAt,
            source:      task.source,
            tags:        task.tags,
            runAt:       task.runAt,
            doneAt:      task.doneAt,
            error:       task.error,
        };
    }
}

// ─── EXPORTS ─────────────────────────────────────────────────
export { TaskQueue, TASK_PRIORITY, TASK_STATE, PRIORITY_NAMES, createTask };
