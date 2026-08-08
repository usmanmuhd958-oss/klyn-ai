/**
 * =============================================================================
 * KLYN AI OS — Body Layer — Supervisor
 * File: 2.body/supervisor.ts
 * Version: 1.0.0
 *
 * The Supervisor is the execution watchdog of the body layer:
 *   - Runs supervised tasks with timeout isolation.
 *   - Applies a retry/backoff policy on failure (restart semantics).
 *   - Keeps supervision records for observability and healing decisions.
 * =============================================================================
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ExecutionResult } from '../0.kernel/types.ts';

export interface SupervisionOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
}

export interface SupervisionRecord {
  id: string;
  taskName: string;
  startedAt: number;
  finishedAt: number;
  attempts: number;
  success: boolean;
  lastError: string | null;
  result: ExecutionResult | null;
}

export interface SupervisorStats {
  totalSupervised: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  recordsRetained: number;
  totalAttempts: number;
}

const DEFAULT_OPTIONS: Required<SupervisionOptions> = {
  timeoutMs: 30_000,
  maxAttempts: 3,
  backoffMs: 250,
  backoffMultiplier: 2,
};

export class Supervisor extends EventEmitter {
  [key: string]: any;
  private options: Required<SupervisionOptions>;
  private records = new Map<string, SupervisionRecord>();
  private inFlight = 0;
  private succeeded = 0;
  private failed = 0;
  private totalAttempts = 0;
  private maxRecords: number;

  constructor(options: SupervisionOptions = {}, maxRecords = 1000) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.maxRecords = maxRecords;
  }

  /**
   * Run a supervised task with timeout + retry policy.
   * Emits 'supervision.completed' with the final record.
   */
  public async supervise(
    taskName: string,
    runner: () => Promise<ExecutionResult> | ExecutionResult,
    options: SupervisionOptions = {}
  ): Promise<SupervisionRecord> {
    // Merge only defined keys — a spread of `{ maxAttempts: undefined }` would
    // otherwise wipe the configured defaults.
    const merged = { ...this.options };
    for (const key of Object.keys(options) as Array<keyof SupervisionOptions>) {
      const value = options[key];
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    const id = randomUUID();
    const record: SupervisionRecord = {
      id,
      taskName,
      startedAt: Date.now(),
      finishedAt: 0,
      attempts: 0,
      success: false,
      lastError: null,
      result: null,
    };

    this.inFlight++;
    let delay = merged.backoffMs;

    for (let attempt = 1; attempt <= merged.maxAttempts; attempt++) {
      record.attempts = attempt;
      this.totalAttempts++;
      try {
        const result = await withTimeout(() => Promise.resolve().then(runner), merged.timeoutMs);
        record.result = result;
        record.success = result.success;
        record.lastError = result.error?.message ?? null;
        record.finishedAt = Date.now();
        this.succeeded++;
        this.finalize(record);
        return record;
      } catch (err) {
        record.lastError = (err as Error).message;
        if (attempt < merged.maxAttempts) {
          await sleep(delay);
          delay *= merged.backoffMultiplier;
        }
      }
    }

    record.finishedAt = Date.now();
    this.failed++;
    this.finalize(record);
    return record;
  }

  public getRecord(id: string): SupervisionRecord | undefined {
    return this.records.get(id);
  }

  public getStats(): SupervisorStats {
    return {
      totalSupervised: this.records.size,
      succeeded: this.succeeded,
      failed: this.failed,
      inFlight: this.inFlight,
      recordsRetained: this.records.size,
      totalAttempts: this.totalAttempts,
    };
  }

  private finalize(record: SupervisionRecord): void {
    this.inFlight--;
    this.records.set(record.id, record);
    if (this.records.size > this.maxRecords) {
      const oldest = Array.from(this.records.keys())[0];
      this.records.delete(oldest);
    }
    this.emit('supervision.completed', record);
  }
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Supervised task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve()
      .then(fn)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default Supervisor;
