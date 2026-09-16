/**
 * =============================================================================
 * KLYN AI OS — GENESIS PLATFORM — Shared Runtime Primitives
 * File: genesis/platform/modules.ts
 *
 * Zero-dependency primitives shared by every evolution layer (V671–V700):
 *   LayerModule contract, EventBus, RingBuffer, TokenBucket, monotonic clock,
 *   Logger, and the layer policy envelope (normalizePolicies).
 *
 * Compatibility: Node 18+ / Bun / Termux. No external packages.
 * =============================================================================
 */

/* ----------------------------------------------------------------------------
 * Module contract — every layer module implements this.
 * -------------------------------------------------------------------------- */

export interface LayerModule {
  name: string;
  role: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/* ----------------------------------------------------------------------------
 * Policy envelope — layer tuning knobs enforced by the Controller.
 * -------------------------------------------------------------------------- */

export interface PolicySet {
  maxEntities?: number;
  tickMs?: number;
  batchSize?: number;
  ringSize?: number;
  consensusThreshold?: number;
  compactionThreshold?: number;
  quota?: number;
}

export const DEFAULT_POLICIES: Required<PolicySet> = Object.freeze({
  maxEntities: 1024,
  tickMs: 25,
  batchSize: 64,
  ringSize: 256,
  consensusThreshold: 0.75,
  compactionThreshold: 0.5,
  quota: 1000,
});

export type ResolvedPolicies = Required<PolicySet>;

export function normalizePolicies(overrides?: PolicySet): ResolvedPolicies {
  if (!overrides) return DEFAULT_POLICIES;
  return {
    maxEntities: overrides.maxEntities ?? DEFAULT_POLICIES.maxEntities,
    tickMs: overrides.tickMs ?? DEFAULT_POLICIES.tickMs,
    batchSize: overrides.batchSize ?? DEFAULT_POLICIES.batchSize,
    ringSize: overrides.ringSize ?? DEFAULT_POLICIES.ringSize,
    consensusThreshold: overrides.consensusThreshold ?? DEFAULT_POLICIES.consensusThreshold,
    compactionThreshold: overrides.compactionThreshold ?? DEFAULT_POLICIES.compactionThreshold,
    quota: overrides.quota ?? DEFAULT_POLICIES.quota,
  };
}

/* ----------------------------------------------------------------------------
 * Monotonic clock — high-resolution when available, wall clock otherwise.
 * -------------------------------------------------------------------------- */

export function monotonic(): number {
  const g = globalThis as { performance?: { now(): number } };
  return g.performance && typeof g.performance.now === 'function'
    ? g.performance.now()
    : Date.now();
}

/* ----------------------------------------------------------------------------
 * EventBus — typed-topic fan-out with subscriber isolation and counting.
 * -------------------------------------------------------------------------- */

export type BusHandler = (payload: unknown) => void;
export type Unsubscribe = () => void;

export class EventBus {
  readonly #subs = new Map<string, Set<BusHandler>>();
  #delivered = 0;

  on(topic: string, handler: BusHandler): Unsubscribe {
    let set = this.#subs.get(topic);
    if (!set) {
      set = new Set();
      this.#subs.set(topic, set);
    }
    set.add(handler);
    return () => {
      if (set) set.delete(handler);
    };
  }

  emit(topic: string, payload?: unknown): number {
    const set = this.#subs.get(topic);
    if (!set || set.size === 0) return 0;
    this.#delivered += set.size;
    for (const handler of set) {
      try {
        handler(payload);
      } catch {
        /* subscriber isolation: one handler must not break the bus */
      }
    }
    return set.size;
  }

  topics(): string[] {
    return [...this.#subs.keys()];
  }

  clear(): void {
    this.#subs.clear();
  }

  get delivered(): number {
    return this.#delivered;
  }
}

/* ----------------------------------------------------------------------------
 * RingBuffer — fixed-capacity overwrite buffer for telemetry windows.
 * -------------------------------------------------------------------------- */

export class RingBuffer<T> {
  readonly #buf: T[];
  readonly #cap: number;
  #head = 0;
  #len = 0;

  constructor(capacity: number) {
    this.#cap = Math.max(1, capacity | 0);
    this.#buf = new Array<T>(this.#cap);
  }

  push(value: T): void {
    this.#buf[(this.#head + this.#len) % this.#cap] = value;
    if (this.#len === this.#cap) this.#head = (this.#head + 1) % this.#cap;
    else this.#len += 1;
  }

  get size(): number {
    return this.#len;
  }

  last(): T | undefined {
    if (this.#len === 0) return undefined;
    return this.#buf[(this.#head + this.#len - 1) % this.#cap];
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.#len; i += 1) {
      out.push(this.#buf[(this.#head + i) % this.#cap] as T);
    }
    return out;
  }

  clear(): void {
    this.#head = 0;
    this.#len = 0;
  }
}

/* ----------------------------------------------------------------------------
 * TokenBucket — O(1) rate limiter for controller quotas.
 * -------------------------------------------------------------------------- */

export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  #tokens: number;
  #last: number;

  constructor(capacity: number, refillPerMs: number) {
    this.#capacity = Math.max(1, capacity);
    this.#refillPerMs = Math.max(0, refillPerMs);
    this.#tokens = this.#capacity;
    this.#last = monotonic();
  }

  take(tokens = 1): boolean {
    const now = monotonic();
    this.#tokens = Math.min(this.#capacity, this.#tokens + (now - this.#last) * this.#refillPerMs);
    this.#last = now;
    if (this.#tokens < tokens) return false;
    this.#tokens -= tokens;
    return true;
  }

  get available(): number {
    return this.#tokens;
  }
}

/* ----------------------------------------------------------------------------
 * Logger — leveled, prefixed, zero-dependency.
 * -------------------------------------------------------------------------- */

export const LogLevel = { Debug: 0, Info: 1, Warn: 2, Error: 3 } as const;
export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

const LOG_TAGS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export class Logger {
  readonly prefix: string;
  readonly level: LogLevelValue;

  constructor(prefix: string, level: LogLevelValue = LogLevel.Info) {
    this.prefix = prefix;
    this.level = level;
  }

  debug(message: string, ...rest: unknown[]): void {
    this.log(LogLevel.Debug, message, rest);
  }

  info(message: string, ...rest: unknown[]): void {
    this.log(LogLevel.Info, message, rest);
  }

  warn(message: string, ...rest: unknown[]): void {
    this.log(LogLevel.Warn, message, rest);
  }

  error(message: string, ...rest: unknown[]): void {
    this.log(LogLevel.Error, message, rest);
  }

  private log(level: LogLevelValue, message: string, rest: unknown[]): void {
    if (level < this.level) return;
    const tag = LOG_TAGS[level] ?? 'INFO';
    const suffix = rest.length > 0 ? ' ' + rest.map((r) => JSON.stringify(r)).join(' ') : '';
    const line = '[' + this.prefix + '] [' + tag + '] ' + message + suffix;
    if (level >= LogLevel.Error) console.error(line);
    else console.log(line);
  }
}
