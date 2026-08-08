/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 06: OmniversalMemoryArchitecture
 * File: genesis/v670/components/OmniversalMemoryArchitecture.ts
 * Version: 1.0.0
 *
 * The unified memory plane of the V670 runtime. Wires the real layers:
 *   - 3.memory/unified_memory.ts (UnifiedMemory — working/short/long term)
 *   - 1.brain/vector_store.ts (VectorStore — semantic index)
 *   - 1.brain/memory.ts (Memory — brain working memory)
 *   - native/kernel_core (KlynKernelEngine — encrypted vault, optional)
 *
 * Exposes typed store/retrieve/search and persistence to every other module.
 * =============================================================================
 */

import { UnifiedMemory } from '../../../3.memory/unified_memory.js';
import { VectorStore } from '../../../1.brain/vector_store.js';
import { Memory } from '../../../1.brain/memory.js';
import { KlynKernelEngine } from '../../../native/kernel_core/index.js';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface MemoryStoreOptions {
  tags?: string[];
  ttlMs?: number;
  embed?: boolean;
}

export interface MemorySearchResult {
  key: string;
  score: number;
}

export class OmniversalMemoryArchitecture implements V670Module {
  [key: string]: any;
  readonly id = 'omniversal-memory';
  readonly name = 'Omniversal Memory Architecture';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private core: UnifiedMemory;
  private vectors: VectorStore;
  private brainMemory: Memory;
  private vault: { setSecret: (k: string, v: string) => void; getSecret: (k: string) => string | null } | null = null;
  private stores = 0;
  private retrieves = 0;
  private searches = 0;

  constructor() {
    this.core = new UnifiedMemory();
    this.vectors = new VectorStore();
    this.brainMemory = new Memory();
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;
    if (ctx.config.persistDir) {
      this.vectors = new VectorStore(`${ctx.config.persistDir}/vector-store.json`);
    }
    // Optional native vault — degrades gracefully when the .node binary is absent.
    if (ctx.config.native) {
      try {
        const engine = new KlynKernelEngine();
        this.vault = {
          setSecret: (k, v) => engine.setSecret(k, v),
          getSecret: (k) => engine.getSecret(k),
        };
        ctx.logger.info('native encrypted vault online');
      } catch {
        this.vault = null;
        ctx.logger.debug('native vault unavailable — plaintext memory mode');
      }
    }
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';
    if (ctx.config.persistDir) {
      const loaded = await this.core.load();
      const vectors = await this.vectors.load();
      ctx.logger.info(`memory restored: ${loaded} entries, ${vectors} vectors`);
    }
    this.ctx!.publish('memory.ready', { entries: this.core.getStats().totalEntries }, this.id);
  }

  /** Store a value with tags and optional embedding. */
  public async store(key: string, value: unknown, options: MemoryStoreOptions = {}): Promise<void> {
    await this.core.store(key, value, { tags: options.tags ?? [], ttlMs: options.ttlMs });
    if (options.embed !== false) {
      await this.brainMemory.save(key, value);
    }
    this.stores++;
    this.ctx?.publish('memory.updated', { key }, this.id);
  }

  public async retrieve(key: string): Promise<unknown> {
    this.retrieves++;
    return this.core.retrieve(key);
  }

  public async search(query: string, topK = 5): Promise<MemorySearchResult[]> {
    this.searches++;
    const hits = await this.brainMemory.findSimilar(query, topK);
    return hits.map((hit) => ({ key: hit.key, score: hit.score }));
  }

  /** Semantic search over embedded records. */
  public searchVectors(vector: number[], topK = 5) {
    this.searches++;
    return this.vectors.search(vector, topK);
  }

  public async forget(key: string): Promise<boolean> {
    const removed = await this.core.delete(key);
    await this.brainMemory.forget(key);
    return removed;
  }

  public getCore(): UnifiedMemory {
    return this.core;
  }

  public getVectorStore(): VectorStore {
    return this.vectors;
  }

  /** Persist all memory planes. */
  public async persist(): Promise<void> {
    await this.core.persist();
    await this.vectors.persist();
  }

  public async stop(): Promise<void> {
    await this.persist();
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    this.core.dispose();
    this.status = 'stopped';
  }

  public metrics(): ModuleMetrics {
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      { stores: this.stores, retrieves: this.retrieves, searches: this.searches },
      {
        entries: this.core.getStats().totalEntries,
        vectors: this.vectors.count,
        workingMemoryBytes: this.core.getStats().workingMemoryBytes,
        vaultOnline: this.vault ? 1 : 0,
      },
      this.lastError
    );
  }
}

export default OmniversalMemoryArchitecture;
