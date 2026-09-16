/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 08: CrossRealityRuntimeEngine
 * File: genesis/v670/components/CrossRealityRuntimeEngine.ts
 * Version: 1.0.0
 *
 * The synchronization plane of the V670 runtime. Reconciles three realms:
 *   - reality realm  → snapshots published by AdaptiveRealityEngine
 *   - memory realm   → the omniversal memory substrate (ctx.memory)
 *   - filesystem realm → the working tree (node:fs adapter)
 *
 * Runs a periodic sync loop, journaling what changed so downstream components
 * (simulator, healer) can act on drift. All realms converge on the memory
 * substrate via tagged keys.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface RealmSyncRecord {
  realm: 'memory' | 'reality' | 'filesystem';
  key: string;
  op: 'updated' | 'removed' | 'observed';
  at: number;
}

export interface CrossRealityStats {
  lastSyncAt: number;
  lastSyncDurationMs: number;
  syncCount: number;
  fileEntries: number;
  journalSize: number;
  realms: Array<{ name: string; status: string }>;
}

const REALITY_SNAPSHOT_KEY = 'reality.last';
const FS_PREFIX = 'fs:';

export class CrossRealityRuntimeEngine implements V670Module {
  [key: string]: any;
  readonly id = 'cross-reality';
  readonly name = 'Cross-Reality Runtime Engine';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private journal: RealmSyncRecord[] = [];
  private fileEntries = new Map<string, number>(); // path -> mtime
  private syncCount = 0;
  private lastSyncAt = 0;
  private lastSyncDurationMs = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;

    // Reality realm: persist every observed snapshot into memory.
    this.ctx.subscribe('reality.observed', (event) => {
      const payload = event.payload as { snapshot?: unknown };
      if (payload.snapshot) {
        void this.storeInMemory(REALITY_SNAPSHOT_KEY, payload.snapshot, ['realm:reality']);
      }
    });

    // Memory realm: journal writes.
    this.ctx.subscribe('memory.updated', (event) => {
      const key = (event.payload as { key?: string }).key;
      if (key) this.journal.push({ realm: 'memory', key, op: 'updated', at: Date.now() });
    });
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    await this.sync();
    this.syncTimer = setInterval(() => {
      void this.sync();
    }, 5000);
    this.syncTimer.unref?.();
    ctx.logger.info('cross-reality engine online (memory ↔ reality ↔ filesystem)');
  }

  /** One reconciliation pass across all realms. */
  public async sync(): Promise<RealmSyncRecord[]> {
    const started = Date.now();
    const records: RealmSyncRecord[] = [];

    // 1. Filesystem realm: scan the working tree (top level).
    try {
      const entries = await fs.readdir(this.ctx!.config.workingDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(this.ctx!.config.workingDirectory, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          const prevMtime = this.fileEntries.get(entry.name);
          if (prevMtime !== stat.mtimeMs) {
            this.fileEntries.set(entry.name, stat.mtimeMs);
            records.push({ realm: 'filesystem', key: entry.name, op: 'updated', at: Date.now() });
            await this.storeInMemory(FS_PREFIX + entry.name, {
              type: entry.isDirectory() ? 'dir' : 'file',
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            }, ['realm:filesystem']);
          }
        } catch {
          /* file vanished mid-scan */
        }
      }
    } catch (err) {
      this.lastError = (err as Error).message;
    }

    // 2. Reality realm: force a fresh observation cycle via the bus.
    this.ctx?.publish('reality.sync.request', { reason: 'periodic' }, this.id);

    this.syncCount++;
    this.lastSyncAt = Date.now();
    this.lastSyncDurationMs = Date.now() - started;
    if (records.length > 0) {
      this.journal.push(...records);
      if (this.journal.length > 2000) {
        this.journal.splice(0, this.journal.length - 2000);
      }
      this.ctx?.publish('reality.sync', { records, fileEntries: this.fileEntries.size }, this.id);
    }
    return records;
  }

  public getJournal(): RealmSyncRecord[] {
    return [...this.journal];
  }

  public getFileEntries(): Map<string, number> {
    return new Map(this.fileEntries);
  }

  public getStats(): CrossRealityStats {
    return {
      lastSyncAt: this.lastSyncAt,
      lastSyncDurationMs: this.lastSyncDurationMs,
      syncCount: this.syncCount,
      fileEntries: this.fileEntries.size,
      journalSize: this.journal.length,
      realms: [
        { name: 'memory', status: this.ctx?.memory ? 'online' : 'offline' },
        { name: 'reality', status: 'online' },
        { name: 'filesystem', status: 'online' },
      ],
    };
  }

  public async stop(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    await this.stop();
  }

  public metrics(): ModuleMetrics {
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      { syncs: this.syncCount },
      {
        fileEntries: this.fileEntries.size,
        journalSize: this.journal.length,
        lastSyncMs: this.lastSyncAt,
      },
      this.lastError
    );
  }

  private async storeInMemory(key: string, value: unknown, tags: string[]): Promise<void> {
    const mem = this.ctx?.memory as { store?: (k: string, v: unknown, o?: { tags?: string[] }) => Promise<void> } | null;
    if (mem?.store) {
      try {
        await mem.store(key, value, { tags });
      } catch {
        /* memory realm temporarily unavailable */
      }
    }
  }
}

export default CrossRealityRuntimeEngine;
