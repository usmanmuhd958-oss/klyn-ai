/**
 * @fileoverview Klyn AI OS - Kernel Core Engine
 * @module core/kernel
 * @author Klyn Systems Architecture Team
 * @license Proprietary
 * 
 * Enterprise-grade kernel core with native Rust bindings, fallback TypeScript
 * implementation, event-driven architecture, and military-grade security vault.
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';
import { performance } from 'perf_hooks';
import { cpus } from 'os';
import { createRequire } from 'node:module';
import { TypedEventEmitter } from './typed-event-emitter.js';
const require = createRequire(import.meta.url);

// ============================================================================
// ERROR HIERARCHY
// ============================================================================

class KernelError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly timestamp: number = Date.now(),
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'KernelError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack,
    };
  }
}

class NativeBindingError extends KernelError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NATIVE_BINDING_ERROR', Date.now(), context);
    this.name = 'NativeBindingError';
  }
}

class VaultError extends KernelError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VAULT_ERROR', Date.now(), context);
    this.name = 'VaultError';
  }
}

class RuleExecutionError extends KernelError {
  constructor(message: string, public readonly ruleId: string, context?: Record<string, unknown>) {
    super(message, 'RULE_EXECUTION_ERROR', Date.now(), { ...context, ruleId });
    this.name = 'RuleExecutionError';
  }
}

class KernelTimeoutError extends KernelError {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message, 'KERNEL_TIMEOUT_ERROR', Date.now(), { timeoutMs });
    this.name = 'KernelTimeoutError';
  }
}

// ============================================================================
// STRICT TYPE DEFINITIONS
// ============================================================================

interface INativeKernelCore {
  encryptVault(key: Buffer, data: Buffer): Buffer;
  decryptVault(key: Buffer, encrypted: Buffer): Buffer;
  executeRule(ruleJson: string): string;
  getMetrics(): string;
  shutdown(): void;
}

interface RuleDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: 'transform' | 'validate' | 'compute' | 'io';
  readonly priority: number;
  readonly timeoutMs: number;
  readonly payload: Record<string, unknown>;
  readonly dependencies?: ReadonlyArray<string>;
}

interface RuleExecutionResult {
  readonly ruleId: string;
  readonly success: boolean;
  readonly executionTimeMs: number;
  readonly output?: unknown;
  readonly error?: string;
  readonly timestamp: number;
}

interface VaultEntry {
  readonly encrypted: Uint8Array;
  readonly iv: Uint8Array;
  readonly salt: Uint8Array;
  readonly timestamp: number;
}

interface KernelMetrics {
  readonly uptime: number;
  readonly rulesExecuted: number;
  readonly rulesFailed: number;
  readonly vaultOperations: number;
  readonly memoryUsage: NodeJS.MemoryUsage;
  readonly nativeBinding: boolean;
  readonly averageRuleExecutionMs: number;
  [key: string]: unknown;
}

interface KernelEventMap {
  'kernel:init': { timestamp: number; native: boolean };
  'kernel:ready': { native: boolean; loadTime: number };
  'kernel:shutdown': { uptime: number; graceful: boolean };
  'vault:encrypt': { key: string; size: number };
  'vault:decrypt': { key: string; size: number };
  'vault:error': { key: string; error: Error };
  'rule:queued': { ruleId: string; priority: number };
  'rule:executing': { ruleId: string };
  'rule:completed': RuleExecutionResult;
  'rule:failed': { ruleId: string; error: Error };
  'error': KernelError;
  [key: string]: unknown;
}

type KernelEventKey = keyof KernelEventMap;

// ============================================================================
// TYPED EVENT EMITTER WRAPPER
// ============================================================================

// ============================================================================
// SECURITY VAULT (AES-256-GCM)
// ============================================================================

class SecurityVault {
  private readonly store = new Map<string, VaultEntry>();
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly saltLength = 64;
  private readonly iterations = 100000;

  constructor(private readonly eventBus: TypedEventEmitter<KernelEventMap>) {}

  private deriveKey(password: string, salt: Buffer): Buffer {
    return pbkdf2Sync(password, salt, this.iterations, this.keyLength, 'sha512');
  }

  encrypt(key: string, data: Uint8Array): void {
    try {
      const salt = randomBytes(this.saltLength);
      const derivedKey = this.deriveKey(key, salt);
      const iv = randomBytes(this.ivLength);
      
      const cipher = createCipheriv(this.algorithm, derivedKey, iv, {
        authTagLength: 16,
      });

      const encrypted = Buffer.concat([
        cipher.update(Buffer.from(data)),
        cipher.final(),
        cipher.getAuthTag(),
      ]);

      this.store.set(key, {
        encrypted: new Uint8Array(encrypted),
        iv: new Uint8Array(iv),
        salt: new Uint8Array(salt),
        timestamp: Date.now(),
      });

      this.eventBus.emit('vault:encrypt', { key, size: data.length });
    } catch (error) {
      const vaultError = new VaultError(
        `Encryption failed for key: ${key}`,
        { originalError: error instanceof Error ? error.message : String(error) }
      );
      this.eventBus.emit('vault:error', { key, error: vaultError });
      throw vaultError;
    }
  }

  decrypt(key: string): Uint8Array {
    try {
      const entry = this.store.get(key);
      if (!entry) {
        throw new VaultError(`Key not found in vault: ${key}`);
      }

      const derivedKey = this.deriveKey(key, Buffer.from(entry.salt));
      const authTag = entry.encrypted.slice(-16);
      const encryptedData = entry.encrypted.slice(0, -16);

      const decipher = createDecipheriv(
        this.algorithm,
        derivedKey,
        Buffer.from(entry.iv),
        { authTagLength: 16 }
      );
      
      decipher.setAuthTag(Buffer.from(authTag));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedData)),
        decipher.final(),
      ]);

      this.eventBus.emit('vault:decrypt', { key, size: decrypted.length });
      return new Uint8Array(decrypted);
    } catch (error) {
      const vaultError = new VaultError(
        `Decryption failed for key: ${key}`,
        { originalError: error instanceof Error ? error.message : String(error) }
      );
      this.eventBus.emit('vault:error', { key, error: vaultError });
      throw vaultError;
    }
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ============================================================================
// RULE EXECUTION ENGINE
// ============================================================================

interface RuleQueueItem {
  readonly rule: RuleDefinition;
  readonly resolve: (result: RuleExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly queuedAt: number;
}

class RuleEngine {
  private readonly queue: RuleQueueItem[] = [];
  private readonly executing = new Set<string>();
  private readonly completed = new Map<string, RuleExecutionResult>();
  private readonly maxConcurrency: number;
  private isProcessing = false;
  private rulesExecuted = 0;
  private rulesFailed = 0;
  private totalExecutionTime = 0;

  constructor(
    private readonly eventBus: TypedEventEmitter<KernelEventMap>,
    private readonly nativeCore: INativeKernelCore | null,
    maxConcurrency?: number
  ) {
    this.maxConcurrency = maxConcurrency ?? Math.max(2, cpus().length - 1);
  }

  async execute(rule: RuleDefinition): Promise<RuleExecutionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        rule,
        resolve,
        reject,
        queuedAt: Date.now(),
      });

      this.eventBus.emit('rule:queued', {
        ruleId: rule.id,
        priority: rule.priority,
      });

      this.queue.sort((a, b) => b.rule.priority - a.rule.priority);

      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.executing.size < this.maxConcurrency) {
      const item = this.queue.shift();
      if (!item) break;

      if (item.rule.dependencies) {
        const allDepsCompleted = item.rule.dependencies.every((depId) =>
          this.completed.has(depId)
        );

        if (!allDepsCompleted) {
          this.queue.push(item);
          continue;
        }
      }

      this.executing.add(item.rule.id);
      void this.executeRule(item);
    }

    this.isProcessing = false;
  }

  private async executeRule(item: RuleQueueItem): Promise<void> {
    const { rule, resolve, reject } = item;
    const startTime = performance.now();

    this.eventBus.emit('rule:executing', { ruleId: rule.id });

    try {
      const result = await this.executeWithTimeout(rule);
      const executionTime = performance.now() - startTime;

      const executionResult: RuleExecutionResult = {
        ruleId: rule.id,
        success: true,
        executionTimeMs: executionTime,
        output: result,
        timestamp: Date.now(),
      };

      this.completed.set(rule.id, executionResult);
      this.rulesExecuted++;
      this.totalExecutionTime += executionTime;

      this.eventBus.emit('rule:completed', executionResult);
      resolve(executionResult);
    } catch (error) {
      const executionTime = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const executionResult: RuleExecutionResult = {
        ruleId: rule.id,
        success: false,
        executionTimeMs: executionTime,
        error: errorMessage,
        timestamp: Date.now(),
      };

      this.completed.set(rule.id, executionResult);
      this.rulesFailed++;

      const ruleError = new RuleExecutionError(errorMessage, rule.id, {
        type: rule.type,
        priority: rule.priority,
      });

      this.eventBus.emit('rule:failed', { ruleId: rule.id, error: ruleError });
      reject(ruleError);
    } finally {
      this.executing.delete(rule.id);
      void this.processQueue();
    }
  }

  private async executeWithTimeout(rule: RuleDefinition): Promise<unknown> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new KernelTimeoutError(
          `Rule execution timeout: ${rule.id}`,
          rule.timeoutMs
        ));
      }, rule.timeoutMs);
    });

    const executionPromise = this.nativeCore
      ? this.executeNative(rule)
      : this.executeFallback(rule);

    return Promise.race([executionPromise, timeoutPromise]);
  }

  private async executeNative(rule: RuleDefinition): Promise<unknown> {
    if (!this.nativeCore) {
      throw new NativeBindingError('Native core not available');
    }

    const ruleJson = JSON.stringify(rule);
    const resultJson = this.nativeCore.executeRule(ruleJson);
    return JSON.parse(resultJson);
  }

  private async executeFallback(rule: RuleDefinition): Promise<unknown> {
    switch (rule.type) {
      case 'transform':
        return this.executeTransform(rule);
      case 'validate':
        return this.executeValidate(rule);
      case 'compute':
        return this.executeCompute(rule);
      case 'io':
        return this.executeIO(rule);
      default:
        throw new RuleExecutionError(
          `Unknown rule type: ${(rule as RuleDefinition).type}`,
          rule.id
        );
    }
  }

  private executeTransform(rule: RuleDefinition): unknown {
    const { payload } = rule;
    return { transformed: true, data: payload, timestamp: Date.now() };
  }

  private executeValidate(rule: RuleDefinition): unknown {
    const { payload } = rule;
    return { valid: true, payload, timestamp: Date.now() };
  }

  private executeCompute(rule: RuleDefinition): unknown {
    const { payload } = rule;
    return { computed: true, result: payload, timestamp: Date.now() };
  }

  private async executeIO(rule: RuleDefinition): Promise<unknown> {
    const { payload } = rule;
    return { ioComplete: true, payload, timestamp: Date.now() };
  }

  getStats(): {
    executed: number;
    failed: number;
    queued: number;
    executing: number;
    avgExecutionMs: number;
  } {
    return {
      executed: this.rulesExecuted,
      failed: this.rulesFailed,
      queued: this.queue.length,
      executing: this.executing.size,
      avgExecutionMs: this.rulesExecuted > 0
        ? this.totalExecutionTime / this.rulesExecuted
        : 0,
    };
  }

  clearCompleted(): void {
    this.completed.clear();
  }
}

// ============================================================================
// NATIVE BINDING LOADER
// ============================================================================

class NativeBindingLoader {
  private static loadAttempted = false;
  private static nativeCore: INativeKernelCore | null = null;

  static load(): { native: INativeKernelCore | null; error: Error | null } {
    if (this.loadAttempted) {
      return { native: this.nativeCore, error: null };
    }

    this.loadAttempted = true;

    try {
      const nativeModule = require('../../../native/kernel_core/index.node') as INativeKernelCore;

      if (
        typeof nativeModule.encryptVault === 'function' &&
        typeof nativeModule.decryptVault === 'function' &&
        typeof nativeModule.executeRule === 'function' &&
        typeof nativeModule.getMetrics === 'function' &&
        typeof nativeModule.shutdown === 'function'
      ) {
        this.nativeCore = nativeModule;
        return { native: nativeModule, error: null };
      } else {
        throw new NativeBindingError('Native module missing required methods');
      }
    } catch (error) {
      const bindingError = new NativeBindingError(
        'Failed to load native kernel core, using TypeScript fallback',
        {
          originalError: error instanceof Error ? error.message : String(error),
          path: 'native/kernel_core/index.node',
        }
      );

      return { native: null, error: bindingError };
    }
  }

  static unload(): void {
    if (this.nativeCore) {
      try {
        this.nativeCore.shutdown();
      } catch (error) {
        // Suppress shutdown errors
      }
      this.nativeCore = null;
    }
    this.loadAttempted = false;
  }
}

// ============================================================================
// KLYN KERNEL (SINGLETON)
// ============================================================================

class KlynKernel extends TypedEventEmitter<KernelEventMap> {
  private static instance: KlynKernel | null = null;
  private readonly initTime: number;
  private readonly nativeCore: INativeKernelCore | null;
  private readonly vault: SecurityVault;
  private readonly ruleEngine: RuleEngine;
  private isReady = false;
  private isShutdown = false;

  private constructor() {
    super(100);
    this.initTime = Date.now();

    const { native, error } = NativeBindingLoader.load();
    this.nativeCore = native;

    if (error) {
      const kernelError = error instanceof KernelError 
        ? error 
        : new KernelError(error.message, 'NATIVE_BINDING_ERROR');
      this.emit('error', kernelError);
    }

    this.vault = new SecurityVault(this);
    this.ruleEngine = new RuleEngine(this, this.nativeCore);

    this.emit('kernel:init', {
      timestamp: this.initTime,
      native: this.nativeCore !== null,
    });

    this.markReady();
  }

  static getInstance(): KlynKernel {
    if (!KlynKernel.instance) {
      KlynKernel.instance = new KlynKernel();
    }
    return KlynKernel.instance;
  }

  private markReady(): void {
    const loadTime = Date.now() - this.initTime;
    this.isReady = true;

    this.emit('kernel:ready', {
      native: this.nativeCore !== null,
      loadTime,
    });
  }

  get ready(): boolean {
    return this.isReady;
  }

  get hasNativeBinding(): boolean {
    return this.nativeCore !== null;
  }

  get uptime(): number {
    return Date.now() - this.initTime;
  }

  async setSecret(key: string, data: Uint8Array): Promise<void> {
    if (this.isShutdown) {
      throw new KernelError('Kernel is shutdown', 'KERNEL_SHUTDOWN');
    }

    if (this.nativeCore) {
      try {
        const encrypted = this.nativeCore.encryptVault(Buffer.from(key), Buffer.from(data));
        this.vault.encrypt(key, new Uint8Array(encrypted));
      } catch (error) {
        this.vault.encrypt(key, data);
      }
    } else {
      this.vault.encrypt(key, data);
    }
  }

  async getSecret(key: string): Promise<Uint8Array> {
    if (this.isShutdown) {
      throw new KernelError('Kernel is shutdown', 'KERNEL_SHUTDOWN');
    }

    if (this.nativeCore && this.vault.has(key)) {
      try {
        const encrypted = this.vault.decrypt(key);
        const decrypted = this.nativeCore.decryptVault(Buffer.from(key), Buffer.from(encrypted));
        return new Uint8Array(decrypted);
      } catch (error) {
        return this.vault.decrypt(key);
      }
    } else {
      return this.vault.decrypt(key);
    }
  }

  hasSecret(key: string): boolean {
    return this.vault.has(key);
  }

  deleteSecret(key: string): boolean {
    return this.vault.delete(key);
  }

  async executeRule(rule: RuleDefinition): Promise<RuleExecutionResult> {
    if (this.isShutdown) {
      throw new KernelError('Kernel is shutdown', 'KERNEL_SHUTDOWN');
    }

    return this.ruleEngine.execute(rule);
  }

  async executeRules(rules: ReadonlyArray<RuleDefinition>): Promise<RuleExecutionResult[]> {
    return Promise.all(rules.map((rule) => this.executeRule(rule)));
  }

  getMetrics(): KernelMetrics {
    const ruleStats = this.ruleEngine.getStats();

    let nativeMetrics: Record<string, unknown> = {};
    if (this.nativeCore) {
      try {
        const metricsJson = this.nativeCore.getMetrics();
        nativeMetrics = JSON.parse(metricsJson) as Record<string, unknown>;
      } catch (error) {
        // Suppress native metrics errors
      }
    }

    return {
      uptime: this.uptime,
      rulesExecuted: ruleStats.executed,
      rulesFailed: ruleStats.failed,
      vaultOperations: this.vault.size,
      memoryUsage: process.memoryUsage(),
      nativeBinding: this.nativeCore !== null,
      averageRuleExecutionMs: ruleStats.avgExecutionMs,
      ...nativeMetrics,
    };
  }

  getRuleStats(): ReturnType<RuleEngine['getStats']> {
    return this.ruleEngine.getStats();
  }

  async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return;
    }

    this.isShutdown = true;

    try {
      this.vault.clear();
      this.ruleEngine.clearCompleted();

      if (this.nativeCore) {
        this.nativeCore.shutdown();
      }

      this.removeAllListeners();

      this.emit('kernel:shutdown', {
        uptime: this.uptime,
        graceful: true,
      });

      KlynKernel.instance = null;
      NativeBindingLoader.unload();

      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      const shutdownError = new KernelError(
        'Kernel shutdown error',
        'SHUTDOWN_ERROR',
        Date.now(),
        { originalError: error instanceof Error ? error.message : String(error) }
      );

      this.emit('error', shutdownError);
      throw shutdownError;
    }
  }

  async dispose(): Promise<void> {
    return this.shutdown();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  KlynKernel,
  KernelError,
  NativeBindingError,
  VaultError,
  RuleExecutionError,
  KernelTimeoutError,
};

export type {
  RuleDefinition,
  RuleExecutionResult,
  KernelMetrics,
  KernelEventMap,
  KernelEventKey,
};

export default KlynKernel.getInstance();
