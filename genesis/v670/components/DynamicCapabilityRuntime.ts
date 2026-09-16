/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 09: DynamicCapabilityRuntime
 * File: genesis/v670/components/DynamicCapabilityRuntime.ts
 * Version: 1.0.0
 *
 * The capability plane of the V670 runtime:
 *   - Typed capability registry (register / unregister / lookup / acquire).
 *   - Permission-governed acquisition with an allowlist policy.
 *   - Optional plugin discovery through kernel/plugin-engine.ts (PluginEngine).
 *   - JSON persistence of the capability manifest.
 *
 * MarketplaceRegistry (5.marketplace) is a documented future adapter that
 * requires the optional better-sqlite3 dependency.
 * =============================================================================
 */

import { PluginEngine } from '../../../kernel/plugin-engine.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { moduleMetrics, type ModuleMetrics, type RuntimeContext, type V670Module, type V670Status } from '../types.js';

export interface V670Capability {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  enabled: boolean;
  registeredAt: number;
}

export interface CapabilityPolicy {
  /** Permissions that are always denied. */
  denylist: string[];
}

export interface CapabilityRuntimeStats {
  total: number;
  enabled: number;
  pluginsLoaded: number;
  acquisitions: number;
  denials: number;
  persisted: boolean;
}

const DEFAULT_POLICY: CapabilityPolicy = { denylist: ['fs.write-outside-root', 'network.egress-arbitrary'] };

export class DynamicCapabilityRuntime implements V670Module {
  [key: string]: any;
  readonly id = 'dynamic-capability';
  readonly name = 'Dynamic Capability Runtime';
  status: V670Status = 'registered';
  lastError: string | null = null;
  startedAt: number | null = null;

  private ctx: RuntimeContext | null = null;
  private capabilities = new Map<string, V670Capability>();
  private policy: CapabilityPolicy;
  private pluginEngine: PluginEngine | null = null;
  private pluginsLoaded = 0;
  private acquisitions = 0;
  private denials = 0;
  private manifestPath: string | null = null;

  constructor(policy: CapabilityPolicy = DEFAULT_POLICY) {
    this.policy = policy;
  }

  public register(ctx: RuntimeContext): void {
    this.ctx = ctx;
    if (ctx.config.persistDir) {
      this.manifestPath = path.join(ctx.config.persistDir, 'capabilities.json');
    }

    if (ctx.config.pluginsDir) {
      try {
        this.pluginEngine = new PluginEngine(ctx.config.pluginsDir, {
          logger: ctx.logger,
        });
      } catch (err) {
        this.lastError = `plugin engine unavailable: ${(err as Error).message}`;
      }
    }
  }

  public async start(ctx: RuntimeContext): Promise<void> {
    this.startedAt = Date.now();
    this.status = 'running';

    if (this.manifestPath) {
      const loaded = await this.loadManifest();
      ctx.logger.info(`capability manifest restored: ${loaded} capabilities`);
    }

    if (this.pluginEngine) {
      try {
        await this.pluginEngine.discoverAndLoad();
        this.pluginsLoaded = 1;
      } catch (err) {
        this.lastError = (err as Error).message;
      }
    }

    ctx.logger.info(`dynamic capability runtime online: ${this.capabilities.size} capabilities`);
  }

  public registerCapability(capability: Omit<V670Capability, 'registeredAt'>): void {
    this.capabilities.set(capability.id, { ...capability, registeredAt: Date.now() });
    this.ctx?.publish('capability.registered', { id: capability.id }, this.id);
  }

  public unregisterCapability(id: string): boolean {
    const removed = this.capabilities.delete(id);
    if (removed) this.ctx?.publish('capability.unregistered', { id }, this.id);
    return removed;
  }

  public lookup(id: string): V670Capability | undefined {
    return this.capabilities.get(id);
  }

  public list(): V670Capability[] {
    return Array.from(this.capabilities.values());
  }

  public listByPermission(permission: string): V670Capability[] {
    return this.list().filter((cap) => cap.permissions.includes(permission));
  }

  public setEnabled(id: string, enabled: boolean): boolean {
    const cap = this.capabilities.get(id);
    if (!cap) return false;
    cap.enabled = enabled;
    this.ctx?.publish('capability.state', { id, enabled }, this.id);
    return true;
  }

  /**
   * Acquire a capability. Enforces enabled state and the policy denylist.
   */
  public acquire(id: string, requestedPermissions: string[] = []): boolean {
    const cap = this.capabilities.get(id);
    if (!cap) {
      this.denials++;
      return false;
    }
    if (!cap.enabled) {
      this.denials++;
      return false;
    }
    for (const perm of requestedPermissions) {
      if (this.policy.denylist.includes(perm)) {
        this.denials++;
        return false;
      }
    }
    this.acquisitions++;
    this.ctx?.publish('capability.acquired', { id }, this.id);
    return true;
  }

  public async persist(): Promise<void> {
    if (!this.manifestPath) return;
    try {
      await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
      await fs.writeFile(this.manifestPath, JSON.stringify(this.list()), 'utf8');
    } catch (err) {
      this.lastError = `manifest persist failed: ${(err as Error).message}`;
    }
  }

  public getStats(): CapabilityRuntimeStats {
    return {
      total: this.capabilities.size,
      enabled: this.list().filter((c) => c.enabled).length,
      pluginsLoaded: this.pluginsLoaded,
      acquisitions: this.acquisitions,
      denials: this.denials,
      persisted: this.manifestPath !== null,
    };
  }

  public async stop(): Promise<void> {
    await this.persist();
    this.status = 'stopped';
  }

  public async dispose(): Promise<void> {
    this.capabilities.clear();
    this.status = 'stopped';
  }

  public metrics(): ModuleMetrics {
    return moduleMetrics(
      this.id,
      this.name,
      this.status,
      this.startedAt,
      {
        acquisitions: this.acquisitions,
        denials: this.denials,
        plugins: this.pluginsLoaded,
      },
      {
        total: this.capabilities.size,
        enabled: this.list().filter((c) => c.enabled).length,
      },
      this.lastError
    );
  }

  private async loadManifest(): Promise<number> {
    if (!this.manifestPath) return 0;
    try {
      const raw = await fs.readFile(this.manifestPath, 'utf8');
      const caps: V670Capability[] = JSON.parse(raw);
      for (const cap of caps) {
        this.capabilities.set(cap.id, cap);
      }
      return caps.length;
    } catch {
      return 0;
    }
  }
}

export default DynamicCapabilityRuntime;
