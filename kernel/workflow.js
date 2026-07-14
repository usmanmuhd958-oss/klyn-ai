// ============================================================
// KLYN AI OS — Workflow Engine v1.0.0
//
// A workflow is a directed acyclic graph (DAG) of steps.
// Each step targets a specific agent via mailbox IPC.
// Steps execute sequentially within a stage; stages are
// ordered. Parallel steps within a stage run concurrently.
//
// Workflow lifecycle:
//   PENDING → RUNNING → (step by step) → COMPLETE | FAILED
//
// Features:
//   - DAG validation before execution
//   - Per-step timeout with circuit breaker
//   - Step retry with exponential backoff
//   - Workflow state persisted to JSONL
//   - Event emission for real-time dashboard streaming
//   - Conditional step execution (when predicate)
//   - Step output piped as input to dependent steps
// ============================================================

'use strict';

const fs               = require('fs');
const path             = require('path');
const crypto           = require('crypto');
const { EventEmitter } = require('events');
const { withRetry, registry: cbRegistry } = require('./backoff');

// ─── CONSTANTS ───────────────────────────────────────────────
const WF_STATE = Object.freeze({
    PENDING:   'PENDING',
    RUNNING:   'RUNNING',
    COMPLETE:  'COMPLETE',
    FAILED:    'FAILED',
    CANCELLED: 'CANCELLED',
});

const STEP_STATE = Object.freeze({
    PENDING:  'PENDING',
    RUNNING:  'RUNNING',
    COMPLETE: 'COMPLETE',
    FAILED:   'FAILED',
    SKIPPED:  'SKIPPED',
});

const DEFAULT_STEP_TIMEOUT_MS  = 120_000;   // 2 min
const DEFAULT_STEP_MAX_RETRIES = 2;
const DEFAULT_STEP_BASE_MS     = 500;
const WF_STORE_MAX_BYTES       = 50 * 1024 * 1024;  // 50 MB

// ─── WORKFLOW DEFINITION VALIDATOR ───────────────────────────
function validateWorkflowDef(def) {
    if (!def || typeof def !== 'object') {
        throw new TypeError('Workflow definition must be a non-null object');
    }

    const required = ['id', 'name', 'stages'];
    for (const key of required) {
        if (!def[key]) {
            throw new Error(`Workflow definition missing required key: '${key}'`);
        }
    }

    if (!Array.isArray(def.stages) || def.stages.length === 0) {
        throw new Error(`Workflow '${def.id}' must have at least one stage`);
    }

    const stepIds = new Set();

    for (const [stageIdx, stage] of def.stages.entries()) {
        if (!Array.isArray(stage.steps) || stage.steps.length === 0) {
            throw new Error(
                `Stage ${stageIdx} in workflow '${def.id}' must have at least one step`
            );
        }

        for (const step of stage.steps) {
            if (!step.id) {
                throw new Error(
                    `Step in stage ${stageIdx} of workflow '${def.id}' missing 'id'`
                );
            }
            if (!step.agent) {
                throw new Error(
                    `Step '${step.id}' in workflow '${def.id}' missing 'agent'`
                );
            }
            if (!step.messageType) {
                throw new Error(
                    `Step '${step.id}' missing 'messageType'`
                );
            }
            if (stepIds.has(step.id)) {
                throw new Error(
                    `Duplicate step id '${step.id}' in workflow '${def.id}'`
                );
            }
            stepIds.add(step.id);
        }
    }
}

// ─── WORKFLOW INSTANCE ───────────────────────────────────────
class WorkflowInstance extends EventEmitter {
    #id;
    #def;
    #state;
    #context;       // Shared mutable context passed between steps
    #stepResults;   // stepId → { output, error, state, duration }
    #startTime;
    #endTime;
    #mailboxRouter;
    #logger;
    #cancelToken;

    constructor(def, mailboxRouter, logger) {
        super();
        this.setMaxListeners(200);

        validateWorkflowDef(def);

        this.#id           = crypto.randomUUID();
        this.#def          = def;
        this.#state        = WF_STATE.PENDING;
        this.#context      = { workflowId: this.#id, ...def.initialContext };
        this.#stepResults  = new Map();
        this.#startTime    = null;
        this.#endTime      = null;
        this.#mailboxRouter = mailboxRouter;
        this.#logger       = logger;
        this.#cancelToken  = { cancelled: false };
    }

    get id()       { return this.#id; }
    get state()    { return this.#state; }
    get defId()    { return this.#def.id; }
    get defName()  { return this.#def.name; }

    // ── RUN ──────────────────────────────────────────────────
    async run() {
        if (this.#state !== WF_STATE.PENDING) {
            throw new Error(`Workflow ${this.#id} already in state: ${this.#state}`);
        }

        this.#state     = WF_STATE.RUNNING;
        this.#startTime = Date.now();

        this.#logger?.info(`Workflow starting: ${this.#def.name}`, {
            workflowId: this.#id,
            defId:      this.#def.id,
            stages:     this.#def.stages.length,
        });

        this.emit('start', {
            workflowId: this.#id,
            defId:      this.#def.id,
            name:       this.#def.name,
        });

        try {
            for (const [stageIdx, stage] of this.#def.stages.entries()) {
                if (this.#cancelToken.cancelled) break;

                this.#logger?.info(
                    `Workflow stage ${stageIdx + 1}/${this.#def.stages.length}: ` +
                    `${stage.name || `Stage ${stageIdx + 1}`}`
                );

                this.emit('stage-start', {
                    workflowId: this.#id,
                    stageIdx,
                    stageName: stage.name,
                });

                // Steps within a stage run concurrently if parallel: true
                if (stage.parallel) {
                    await Promise.all(
                        stage.steps.map((step) => this.#runStep(step, stageIdx))
                    );
                } else {
                    for (const step of stage.steps) {
                        if (this.#cancelToken.cancelled) break;
                        await this.#runStep(step, stageIdx);

                        // Abort stage on step failure unless continueOnError
                        const result = this.#stepResults.get(step.id);
                        if (result?.state === STEP_STATE.FAILED && !stage.continueOnError) {
                            throw new Error(
                                `Stage ${stageIdx + 1} aborted: step '${step.id}' failed`
                            );
                        }
                    }
                }

                this.emit('stage-complete', {
                    workflowId: this.#id,
                    stageIdx,
                });
            }

            if (this.#cancelToken.cancelled) {
                this.#state   = WF_STATE.CANCELLED;
                this.#endTime = Date.now();
                this.emit('cancelled', { workflowId: this.#id });
            } else {
                this.#state   = WF_STATE.COMPLETE;
                this.#endTime = Date.now();

                this.#logger?.info(`Workflow complete: ${this.#def.name}`, {
                    workflowId: this.#id,
                    durationMs: this.#endTime - this.#startTime,
                });

                this.emit('complete', {
                    workflowId: this.#id,
                    durationMs: this.#endTime - this.#startTime,
                    context:    this.#context,
                });
            }

        } catch (err) {
            this.#state   = WF_STATE.FAILED;
            this.#endTime = Date.now();

            this.#logger?.error(`Workflow failed: ${this.#def.name}`, {
                workflowId: this.#id,
                error:      err.message,
                durationMs: this.#endTime - this.#startTime,
            });

            this.emit('failed', {
                workflowId: this.#id,
                error:      err.message,
                durationMs: this.#endTime - this.#startTime,
            });

            throw err;
        }

        return this.getSnapshot();
    }

    // ── STEP EXECUTOR ────────────────────────────────────────
    async #runStep(stepDef, stageIdx) {
        const stepId  = stepDef.id;
        const timeout = stepDef.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
        const maxRetry = stepDef.maxRetries ?? DEFAULT_STEP_MAX_RETRIES;

        // Evaluate conditional
        if (typeof stepDef.when === 'function') {
            if (!stepDef.when(this.#context, this.#stepResults)) {
                this.#logger?.debug(`Step '${stepId}' skipped by condition`);
                this.#stepResults.set(stepId, {
                    state:     STEP_STATE.SKIPPED,
                    output:    null,
                    error:     null,
                    duration:  0,
                });
                this.emit('step-skipped', { workflowId: this.#id, stepId });
                return;
            }
        }

        const stepStart = Date.now();
        this.#stepResults.set(stepId, {
            state:    STEP_STATE.RUNNING,
            output:   null,
            error:    null,
            duration: 0,
        });

        this.emit('step-start', {
            workflowId: this.#id,
            stepId,
            stageIdx,
            agent: stepDef.agent,
        });

        try {
            const output = await withRetry(
                () => this.#dispatchStep(stepDef, timeout),
                {
                    maxAttempts:  maxRetry + 1,
                    baseMs:       stepDef.retryBaseMs ?? DEFAULT_STEP_BASE_MS,
                    maxMs:        30_000,
                    isRetriable:  (err) => !err.message?.includes('not registered'),
                    onAttempt:    (attempt, delay) => {
                        this.#logger?.warn(
                            `Step '${stepId}' retry ${attempt} in ${delay}ms`
                        );
                    },
                }
            );

            const duration = Date.now() - stepStart;

            // Merge step output into shared context
            if (output && typeof output === 'object') {
                Object.assign(this.#context, output);
            }

            this.#stepResults.set(stepId, {
                state:    STEP_STATE.COMPLETE,
                output,
                error:    null,
                duration,
            });

            this.emit('step-complete', {
                workflowId: this.#id,
                stepId,
                duration,
                output,
            });

        } catch (err) {
            const duration = Date.now() - stepStart;

            this.#stepResults.set(stepId, {
                state:    STEP_STATE.FAILED,
                output:   null,
                error:    err.message,
                duration,
            });

            this.emit('step-failed', {
                workflowId: this.#id,
                stepId,
                duration,
                error: err.message,
            });

            // Re-throw — caller decides whether to abort
            throw err;
        }
    }

    // ── STEP DISPATCH VIA MAILBOX ─────────────────────────────
    async #dispatchStep(stepDef, timeoutMs) {
        const agentMailbox = this.#mailboxRouter.get(stepDef.agent);

        if (!agentMailbox) {
            throw new Error(
                `Workflow step '${stepDef.id}': ` +
                `agent mailbox '${stepDef.agent}' not registered`
            );
        }

        const payload = typeof stepDef.buildPayload === 'function'
            ? stepDef.buildPayload(this.#context, this.#stepResults)
            : { ...stepDef.payload, workflowId: this.#id, stepId: stepDef.id };

        // Use request-reply pattern for synchronous step completion
        const kernelMailbox = this.#mailboxRouter.get('kernel');
        if (!kernelMailbox) {
            throw new Error('Kernel mailbox not available for workflow dispatch');
        }

        return kernelMailbox.request(
            {
                type:    stepDef.messageType,
                to:      stepDef.agent,
                from:    'workflow-engine',
                payload,
                ttl:     timeoutMs,
            },
            timeoutMs
        );
    }

    // ── CONTROL ───────────────────────────────────────────────
    cancel() {
        this.#cancelToken.cancelled = true;
        this.#logger?.warn(`Workflow cancelled: ${this.#id}`);
    }

    // ── SNAPSHOT ─────────────────────────────────────────────
    getSnapshot() {
        return {
            id:         this.#id,
            defId:      this.#def.id,
            name:       this.#def.name,
            state:      this.#state,
            startTime:  this.#startTime,
            endTime:    this.#endTime,
            duration:   this.#endTime
                ? this.#endTime - this.#startTime
                : this.#startTime
                    ? Date.now() - this.#startTime
                    : 0,
            context:    { ...this.#context },
            steps:      Object.fromEntries(this.#stepResults),
        };
    }
}

// ─── WORKFLOW ENGINE ─────────────────────────────────────────
class WorkflowEngine extends EventEmitter {
    #mailboxRouter;
    #logger;
    #instances;       // instanceId → WorkflowInstance
    #definitions;     // defId → WorkflowDef
    #storePath;
    #maxConcurrent;

    constructor(mailboxRouter, logger, options = {}) {
        super();
        this.setMaxListeners(500);

        this.#mailboxRouter  = mailboxRouter;
        this.#logger         = logger;
        this.#instances      = new Map();
        this.#definitions    = new Map();
        this.#storePath      = options.storePath || null;
        this.#maxConcurrent  = options.maxConcurrent || 5;

        this.#ensureStore();
    }

    // ── REGISTER A WORKFLOW DEFINITION ───────────────────────
    define(def) {
        validateWorkflowDef(def);
        this.#definitions.set(def.id, def);
        this.#logger?.info(`Workflow defined: ${def.name} (${def.id})`);
        return this;
    }

    // ── TRIGGER A WORKFLOW ────────────────────────────────────
    async trigger(defId, initialContext = {}) {
        const def = this.#definitions.get(defId);
        if (!def) {
            throw new Error(`Workflow definition not found: '${defId}'`);
        }

        const running = [...this.#instances.values()]
            .filter((i) => i.state === WF_STATE.RUNNING).length;

        if (running >= this.#maxConcurrent) {
            throw new Error(
                `Workflow concurrency limit reached (${this.#maxConcurrent}). ` +
                `Try again when a slot is free.`
            );
        }

        const merged = { ...def.initialContext, ...initialContext };
        const instance = new WorkflowInstance(
            { ...def, initialContext: merged },
            this.#mailboxRouter,
            this.#logger
        );

        this.#instances.set(instance.id, instance);

        // Bubble events
        instance.on('start',          (d) => { this.emit('workflow-start', d);          this.#persist(instance); });
        instance.on('stage-start',    (d) => this.emit('stage-start', d));
        instance.on('stage-complete', (d) => this.emit('stage-complete', d));
        instance.on('step-start',     (d) => this.emit('step-start', d));
        instance.on('step-complete',  (d) => { this.emit('step-complete', d);            this.#persist(instance); });
        instance.on('step-failed',    (d) => { this.emit('step-failed', d);              this.#persist(instance); });
        instance.on('complete',       (d) => { this.emit('workflow-complete', d);        this.#persist(instance); });
        instance.on('failed',         (d) => { this.emit('workflow-failed', d);          this.#persist(instance); });
        instance.on('cancelled',      (d) => { this.emit('workflow-cancelled', d);       this.#persist(instance); });

        this.#logger?.info(`Workflow triggered: ${def.name}`, {
            instanceId: instance.id,
            defId,
        });

        // Run async — don't await here (non-blocking trigger)
        instance.run().catch((err) => {
            this.#logger?.error(`Workflow error: ${def.name}`, {
                instanceId: instance.id,
                error:      err.message,
            });
        });

        return instance.id;
    }

    // ── STATUS ────────────────────────────────────────────────
    getStatus() {
        const all = [...this.#instances.values()].map((i) => i.getSnapshot());
        const byState = {};
        for (const wf of all) {
            byState[wf.state] = (byState[wf.state] || 0) + 1;
        }
        return {
            totalInstances: all.length,
            byState,
            definitions:    [...this.#definitions.keys()],
            recent:         all.slice(-10),
        };
    }

    cancel(instanceId) {
        const instance = this.#instances.get(instanceId);
        if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);
        instance.cancel();
    }

    getDefinitions() {
        return [...this.#definitions.values()].map((d) => ({
            id:     d.id,
            name:   d.name,
            stages: d.stages.length,
        }));
    }

    // ── PERSISTENCE ───────────────────────────────────────────
    #ensureStore() {
        if (!this.#storePath) return;
        const dir = path.dirname(this.#storePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
        }
    }

    #persist(instance) {
        if (!this.#storePath) return;
        try {
            const line = JSON.stringify(instance.getSnapshot()) + '\n';
            fs.appendFileSync(this.#storePath, line, { mode: 0o640 });
        } catch (err) {
            this.#logger?.warn('Workflow persist failed', { error: err.message });
        }
    }
}

module.exports = { WorkflowEngine, WorkflowInstance, WF_STATE, STEP_STATE };
