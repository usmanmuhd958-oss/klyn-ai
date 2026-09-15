import { statSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";

export interface DagHealthMetrics {
  readonly totalTasks: number;
  readonly pending: number;
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly blocked: number;
  readonly cancelled: number;
  readonly rolledBack: number;
  readonly dagDurationMs?: number;
}

export interface ProviderLatencyMetrics {
  readonly attempts: number;
  readonly totalMs: number;
  readonly averageMs: number;
}

export interface RouterHealthMetrics {
  readonly attempts: number;
  readonly retries: number;
  readonly failures: number;
  readonly failureRate: number;
  readonly providerAttempts: Readonly<Record<string, number>>;
  readonly providerLatencyMs: Readonly<Record<string, ProviderLatencyMetrics>>;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}

export interface SqliteHealthMetrics {
  readonly databasePath: string;
  readonly databaseBytes: number;
  readonly walBytes: number;
  readonly shmBytes: number;
  readonly checkpoint?: Readonly<{
    busy: number;
    logFrames: number;
    checkpointedFrames: number;
  }>;
  readonly queue: Readonly<{
    pending: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  }>;
}

export interface SupabaseHealthMetrics {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly realtime: "connected" | "disconnected" | "unknown";
  readonly lastEventAt?: number;
  readonly error?: string;
}

export interface KernelHealthSnapshot {
  readonly schemaVersion: 1;
  readonly status: "healthy" | "degraded";
  readonly collectedAt: number;
  readonly collectionMs: number;
  readonly system: {
    uptimeSec: number;
    cpuCount: number;
    loadAverage: readonly number[];
    processMemory: NodeJS.MemoryUsage;
    heapUsedRatio: number;
  };
  readonly swarm: DagHealthMetrics;
  readonly router: RouterHealthMetrics;
  readonly sqlite?: SqliteHealthMetrics;
  readonly supabase: SupabaseHealthMetrics;
}

export interface KernelHealthSources {
  readonly dag?: () => DagHealthMetrics;
  readonly router?: () => RouterHealthMetrics;
  readonly sqlite?: () => SqliteHealthMetrics;
  readonly supabase?: () => SupabaseHealthMetrics;
}

export interface ProductionReadinessOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly requiredEnv?: readonly string[];
  readonly verifyConnectionPools?: () => boolean | Promise<boolean>;
  readonly verifyTables?: () => boolean | Promise<boolean>;
}

export interface ProductionReadinessReport {
  readonly ready: boolean;
  readonly checks: Readonly<{
    environment: boolean;
    connectionPools: boolean;
    databaseTables: boolean;
  }>;
  readonly missingEnvironment: readonly string[];
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

const emptyDag = (): DagHealthMetrics => ({
  totalTasks: 0, pending: 0, queued: 0, running: 0, succeeded: 0, failed: 0,
  skipped: 0, blocked: 0, cancelled: 0, rolledBack: 0,
});

const emptyRouter = (): RouterHealthMetrics => ({
  attempts: 0, retries: 0, failures: 0, failureRate: 0, providerAttempts: {},
  providerLatencyMs: {}, usage: { inputTokens: 0, outputTokens: 0 },
});

const emptySupabase = (): SupabaseHealthMetrics => ({
  configured: false, connected: false, realtime: "unknown",
});

export class KernelHealthController {
  constructor(private readonly sources: KernelHealthSources = {}) {}

  collect(): KernelHealthSnapshot {
    const started = performance.now();
    const memory = process.memoryUsage();
    const heapUsedRatio = memory.heapTotal === 0 ? 0 : memory.heapUsed / memory.heapTotal;
    const dag = this.sources.dag?.() ?? emptyDag();
    const router = this.sources.router?.() ?? emptyRouter();
    const sqlite = this.sources.sqlite?.();
    const supabase = this.sources.supabase?.() ?? emptySupabase();
    const collectionMs = Number((performance.now() - started).toFixed(3));
    const degraded = Boolean(
      heapUsedRatio >= 0.9 ||
      router.failureRate >= 0.5 ||
      (supabase.configured && !supabase.connected),
    );

    return {
      schemaVersion: 1,
      status: degraded ? "degraded" : "healthy",
      collectedAt: Date.now(),
      collectionMs,
      system: {
        uptimeSec: Number(process.uptime().toFixed(3)),
        cpuCount: os.cpus().length,
        loadAverage: os.loadavg().map((value) => Number(value.toFixed(3))),
        processMemory: memory,
        heapUsedRatio: Number(heapUsedRatio.toFixed(6)),
      },
      swarm: dag,
      router,
      sqlite,
      supabase,
    };
  }

  static sqliteSource(options: {
    databasePath: string;
    queue: () => SqliteHealthMetrics["queue"];
    checkpoint?: () => SqliteHealthMetrics["checkpoint"];
  }): () => SqliteHealthMetrics {
    return () => ({
      databasePath: options.databasePath,
      databaseBytes: fileBytes(options.databasePath),
      walBytes: fileBytes(`${options.databasePath}-wal`),
      shmBytes: fileBytes(`${options.databasePath}-shm`),
      checkpoint: options.checkpoint?.(),
      queue: options.queue(),
    });
  }
}

export async function verifyProductionReadiness(options: ProductionReadinessOptions): Promise<ProductionReadinessReport> {
  const required = options.requiredEnv ?? ["NODE_ENV", "HOST", "PORT", "JWT_SECRET", "ADMIN_PASSWORD"];
  const missingEnvironment = required.filter((name) => {
    const value = options.env[name];
    return value === undefined || value.trim() === "";
  });
  const environment = missingEnvironment.length === 0;
  const connectionPools = options.verifyConnectionPools ? await options.verifyConnectionPools() : true;
  const databaseTables = options.verifyTables ? await options.verifyTables() : true;
  return {
    ready: environment && connectionPools && databaseTables,
    checks: { environment, connectionPools, databaseTables },
    missingEnvironment,
  };
}
