/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 — Component 01: KlynOmniversalKernel
 * File: genesis/v670/components/KlynOmniversalKernel.ts
 * Version: 1.0.0
 *
 * The omniversal kernel: the composition root of the V670 runtime. It owns
 * the OmniversalRuntimeKernel substrate and the ten V670 components, then
 * boots them in strict dependency order:
 *
 *   1. omniversal-memory     (substrate every module reads/writes)
 *   2. adaptive-reality      (world model + project state)
 *   3. dynamic-capability    (plugin/capability governance)
 *   4. universal-fabric      (execution plane)
 *   5. runtime-intelligence  (routing, agents, hive)
 *   6. future-simulator      (prediction + impact)
 *   7. cross-reality         (realm synchronization)
 *   8. infinite-orchestrator (the never-ending loop — starts last)
 * =============================================================================
 */

import { OmniversalRuntimeKernel } from './OmniversalRuntimeKernel.js';
import { OmniversalMemoryArchitecture } from './OmniversalMemoryArchitecture.js';
import { AdaptiveRealityEngine } from './AdaptiveRealityEngine.js';
import { DynamicCapabilityRuntime } from './DynamicCapabilityRuntime.js';
import { UniversalExecutionFabric } from './UniversalExecutionFabric.js';
import { RuntimeIntelligenceController } from './RuntimeIntelligenceController.js';
import { FutureRuntimeSimulator } from './FutureRuntimeSimulator.js';
import { CrossRealityRuntimeEngine } from './CrossRealityRuntimeEngine.js';
import { InfiniteRuntimeOrchestrator } from './InfiniteRuntimeOrchestrator.js';
import type { HealthSnapshot, V670Config, V670Module } from '../types.js';

export interface OmniversalKernelOptions {
  config?: Partial<V670Config>;
}

export class KlynOmniversalKernel {
  [key: string]: any;

  readonly runtime: OmniversalRuntimeKernel;
  readonly memory: OmniversalMemoryArchitecture;
  readonly reality: AdaptiveRealityEngine;
  readonly capabilities: DynamicCapabilityRuntime;
  readonly fabric: UniversalExecutionFabric;
  readonly intelligence: RuntimeIntelligenceController;
  readonly simulator: FutureRuntimeSimulator;
  readonly crossReality: CrossRealityRuntimeEngine;
  readonly orchestrator: InfiniteRuntimeOrchestrator;

  constructor(options: OmniversalKernelOptions = {}) {
    this.runtime = new OmniversalRuntimeKernel({ config: options.config });
    this.memory = new OmniversalMemoryArchitecture();
    this.reality = new AdaptiveRealityEngine();
    this.capabilities = new DynamicCapabilityRuntime();
    this.fabric = new UniversalExecutionFabric();
    this.intelligence = new RuntimeIntelligenceController();
    this.simulator = new FutureRuntimeSimulator();
    this.crossReality = new CrossRealityRuntimeEngine();
    this.orchestrator = new InfiniteRuntimeOrchestrator({ runtime: this.runtime });
  }

  /** Register all components (dependency order) and start the runtime. */
  public async boot(): Promise<HealthSnapshot> {
    const order: V670Module[] = [
      this.memory,
      this.reality,
      this.capabilities,
      this.fabric,
      this.intelligence,
      this.simulator,
      this.crossReality,
      this.orchestrator,
    ];

    for (const module of order) {
      this.runtime.register(module);
    }

    // Inject the shared memory substrate into the runtime context.
    this.runtime.setSharedMemory(this.memory.getCore());

    await this.runtime.start();
    this.runtime.logger.info('KLYN Omniversal Kernel booted');
    return this.runtime.getHealth();
  }

  /** Graceful shutdown (reverse boot order). */
  public async shutdown(): Promise<void> {
    await this.runtime.stop();
    await this.runtime.dispose();
  }

  public health(): HealthSnapshot {
    return this.runtime.getHealth();
  }

  public publish(type: string, payload: unknown, source?: string, correlationId?: string): void {
    this.runtime.publish(type, payload, source, correlationId);
  }

  public request(type: string, payload: unknown, timeoutMs?: number): Promise<unknown> {
    return this.runtime.request(type, payload, timeoutMs);
  }

  public getModule(id: string): V670Module | undefined {
    return this.runtime.getModule(id);
  }

  public getStatus() {
    return {
      booted: this.runtime.getHealth().status,
      modules: this.runtime.getHealth().modules.map((m) => ({ id: m.id, status: m.status })),
    };
  }
}

export default KlynOmniversalKernel;
