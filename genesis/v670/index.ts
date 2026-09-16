/**
 * =============================================================================
 * KLYN AI OS — Genesis V670 Omniversal Runtime — Public API
 * File: genesis/v670/index.ts
 * Version: 1.0.0
 *
 * Public entry point. Usage:
 *
 *   import { bootV670 } from './genesis/v670/index.js';
 *   const kernel = await bootV670({ config: { enableIpc: true, tickMs: 250 } });
 *   kernel.health(); kernel.publish('my.event', { ok: true });
 *   await kernel.shutdown();
 * =============================================================================
 */

export * from './types.js';
export * from './ipc/protocol.js';
export * from './ipc/ring-buffer.js';
export * from './ipc/ipc-bus.js';
export * from './ipc/uds-server.js';
export * from './ipc/uds-client.js';

export { KlynOmniversalKernel } from './components/KlynOmniversalKernel.js';
export { OmniversalRuntimeKernel } from './components/OmniversalRuntimeKernel.js';
export { OmniversalMemoryArchitecture } from './components/OmniversalMemoryArchitecture.js';
export { AdaptiveRealityEngine } from './components/AdaptiveRealityEngine.js';
export { DynamicCapabilityRuntime } from './components/DynamicCapabilityRuntime.js';
export { UniversalExecutionFabric } from './components/UniversalExecutionFabric.js';
export { RuntimeIntelligenceController } from './components/RuntimeIntelligenceController.js';
export { FutureRuntimeSimulator } from './components/FutureRuntimeSimulator.js';
export { CrossRealityRuntimeEngine } from './components/CrossRealityRuntimeEngine.js';
export { InfiniteRuntimeOrchestrator } from './components/InfiniteRuntimeOrchestrator.js';

import { KlynOmniversalKernel } from './components/KlynOmniversalKernel.js';
import type { OmniversalKernelOptions } from './components/KlynOmniversalKernel.js';
import type { HealthSnapshot } from './types.js';

export const V670_VERSION = '1.0.0';
export const V670_GENESIS = 'genesis-v670';

/**
 * Boot the omniversal kernel with all ten components.
 */
export async function bootV670(options: OmniversalKernelOptions = {}): Promise<KlynOmniversalKernel> {
  const kernel = new KlynOmniversalKernel(options);
  await kernel.boot();
  return kernel;
}

/** Convenience: boot + immediate health snapshot. */
export async function bootV670AndHealth(options: OmniversalKernelOptions = {}): Promise<HealthSnapshot> {
  const kernel = await bootV670(options);
  return kernel.health();
}

export default bootV670;
