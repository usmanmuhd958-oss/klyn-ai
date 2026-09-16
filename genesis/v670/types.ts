/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 Omniversal Runtime — Shared Contracts
 * File: genesis/v670/types.ts
 * Version: 1.0.0
 *
 * The module lifecycle contract that every V670 component implements, plus
 * the runtime context the omniversal kernel injects into each component.
 * =============================================================================
 */

export type V670Status =
  | 'registered'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'faulted';

export interface ModuleCounters {
  [name: string]: number;
}

export interface ModuleGauges {
  [name: string]: number;
}

export interface ModuleMetrics {
  id: string;
  name: string;
  status: V670Status;
  startedAt: number | null;
  uptimeMs: number;
  counters: ModuleCounters;
  gauges: ModuleGauges;
  lastError: string | null;
}

export interface V670Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * The lifecycle contract every V670 component implements.
 */
export interface V670Module {
  readonly id: string;
  readonly name: string;
  status: V670Status;
  lastError: string | null;
  startedAt: number | null;
  register(ctx: RuntimeContext): void;
  start(ctx: RuntimeContext): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  metrics(): ModuleMetrics;
}

/**
 * The dependency-injection surface handed to every V670 component.
 */
export interface RuntimeContext {
  config: V670Config;
  logger: V670Logger;
  /** Publish an event to the omniversal event bus. */
  publish(type: string, payload: unknown, source?: string, correlationId?: string): void;
  /** In-process request/reply with correlation and timeout. */
  request(type: string, payload: unknown, timeoutMs?: number): Promise<unknown>;
  /** Subscribe to bus events; returns an unsubscribe function. */
  subscribe(type: string, handler: (event: BusEvent) => void): () => void;
  /** Access the shared memory substrate (v670 memory module). */
  memory: unknown;
  /** Current monotonic-ish timestamp. */
  now(): number;
}

export interface BusEvent {
  id: string;
  type: string;
  payload: unknown;
  source: string;
  correlationId: string | null;
  timestamp: number;
}

export interface V670Config {
  kernelId: string;
  /** Enable the Unix domain socket transport. */
  enableIpc: boolean;
  /** Socket path for the UDS transport (defaults under os.tmpdir()). */
  ipcSocketPath: string | null;
  /** Orchestrator tick interval in ms. */
  tickMs: number;
  /** Base working directory for the execution fabric. */
  workingDirectory: string;
  /** Allow native bridges (Rust dlopen / napi vault). Falls back gracefully. */
  native: boolean;
  /** Intelligence mode: embedded (offline) or llm (via LLMGateway). */
  brainMode: 'embedded' | 'llm';
  /** Optional memory persistence directory. */
  persistDir: string | null;
  /** Optional plugin discovery directory. */
  pluginsDir: string | null;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface HealthSnapshot {
  kernelId: string;
  status: 'booted' | 'degraded' | 'stopped';
  uptimeMs: number;
  modules: ModuleMetrics[];
  eventCount: number;
  ipcLatency: LatencyStats | null;
  queueDepth: number;
  ringDepth: number;
  memoryEntries: number;
  timestamp: number;
}

/** Build a metrics snapshot for a module. */
export function moduleMetrics(
  id: string,
  name: string,
  status: V670Status,
  startedAt: number | null,
  counters: ModuleCounters = {},
  gauges: ModuleGauges = {},
  lastError: string | null = null
): ModuleMetrics {
  return {
    id,
    name,
    status,
    startedAt,
    uptimeMs: startedAt === null ? 0 : Date.now() - startedAt,
    counters,
    gauges,
    lastError,
  };
}

/** Default configuration for the omniversal kernel. */
export function defaultV670Config(overrides: Partial<V670Config> = {}): V670Config {
  return {
    kernelId: 'klyn-v670',
    enableIpc: false,
    ipcSocketPath: null,
    tickMs: 1000,
    workingDirectory: process.cwd(),
    native: true,
    brainMode: 'embedded',
    persistDir: null,
    pluginsDir: null,
    ...overrides,
  };
}

export default V670Status;
