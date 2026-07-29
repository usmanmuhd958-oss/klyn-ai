// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
/**
 * =============================================================================
 * KLYN AI OS — Kernel Entry Point
 * File: kernel/kernel-entry.js
 * Version: 3.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * BOOT SEQUENCE (STRICTLY ORDERED):
 *
 *   Step 1: Load .env (development only).
 *   Step 2: vault.initialize()
 *           → Reads all secrets from process.env.
 *           → Immediately purges them from process.env.
 *           → Derives signing and encryption sub-keys via HKDF.
 *   Step 3: Post-purge environment audit.
 *           → Halts if any known secret key is still present.
 *   Step 4: Create the restricted VaultInterface proxy.
 *   Step 5: Construct the AgentParameterManifest.
 *           → Packages all orchestrator dependencies into a sealed object.
 *           → No raw secrets are in the manifest.
 *   Step 6: Construct the Orchestrator with the manifest.
 *           → Orchestrator reads all config from the manifest.
 *           → Orchestrator never accesses process.env.
 *   Step 7: Wire lifecycle event bus observers.
 *           → Healer stub, monitoring, and status observers subscribe here.
 *   Step 8: orchestrator.start()
 *           → Spawns all registered agents.
 *           → Awaits all critical agents reaching READY state.
 *
 * WHAT THIS FILE DOES NOT DO:
 *   - It does not contain business logic.
 *   - It does not remain active in the call stack after the boot sequence.
 *   - It does not pass raw secrets to any module below it.
 *   - It does not call process.env after Step 2 completes.
 *
 * =============================================================================
 */

'use strict';

// ---------------------------------------------------------------------------
// Step 1: Load .env in development only.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({
      path: require('path').resolve(__dirname, '..', '.env'),
    });
  } catch (_) {
    // dotenv not installed, or .env does not exist.
    // Acceptable in all environments where secrets arrive via system env.
  }
}

const path = require('path');

const { createLogger, generateCorrelationId } =
  require('./src/observability/logger');
const { getManifest } =
  require('./src/observability/health_manifest');
const { vault, TOKEN_SCOPE } =
  require('./token-vault');
const { Mailbox } =
  require('./ipc-mailbox');
const { buildManifest } =
  require('./src/lifecycle/agent_parameter_manifest');
const { createVaultInterface } =
  require('./src/lifecycle/vault_interface');
const { getEventBus, LIFECYCLE_EVENT } =
  require('./src/lifecycle/lifecycle_event_bus');
const { Orchestrator } =
  require('./orchestrator');

const log      = createLogger('KernelEntry');
const manifest = getManifest();
const bus      = getEventBus();

// The canonical set of secret keys the vault manages.
// Used for post-purge audit. Must be kept in sync with token-vault.js.
const KNOWN_SECRET_KEYS = Object.freeze([
  'KLYN_VAULT_MASTER_KEY',
  'KLYN_DEEPSEEK_API_KEY',
  'KLYN_LLAMA_API_KEY',
  'KLYN_DB_PASSWORD',
  'KLYN_COLLAB_SECRET',
  'KLYN_ADMIN_TOKEN',
]);

// The canonical agent registry. Defines which agents the kernel manages.
const AGENT_REGISTRY = Object.freeze({
  bug_hunter: {
    module:      'bug_hunter.js',
    description: 'Static analysis and vulnerability detection agent.',
    critical:    true,
  },
});

const KERNEL_ID      = 'KLYN_KERNEL_v5';
const KERNEL_VERSION = '5.0.0';

// =============================================================================
// BOOT FUNCTION
// =============================================================================

async function boot() {
  const bootCorrelId = generateCorrelationId();
  const startedAt    = Date.now();

  log.info('KLYN AI OS kernel entry point starting.', {
    nodeVersion:   process.version,
    pid:           process.pid,
    platform:      process.platform,
    arch:          process.arch,
    env:           process.env.NODE_ENV ?? 'production',
    kernelVersion: KERNEL_VERSION,
    bootCorrelId,
  });

  // =========================================================================
  // STEP 2: Initialize token vault.
  // After this call, process.env contains no secrets.
  // =========================================================================
  log.info('Initializing token vault.', { bootCorrelId });

  try {
    await vault.initialize();
  } catch (err) {
    log.error('FATAL: Vault initialization failed. Cannot start kernel.', {
      reason:    err.message,
      bootCorrelId,
    });
    process.exit(1);
  }

  log.info('Vault initialized. Environment purge complete.', { bootCorrelId });

  // =========================================================================
  // STEP 3: Post-purge environment audit.
  // A leaked secret at this point means the vault failed to purge it.
  // This is a security-critical invariant. Halt on any violation.
  // =========================================================================
  log.info('Running post-vault environment audit.', { bootCorrelId });

  const leakedKeys = KNOWN_SECRET_KEYS.filter(key => !!process.env[key]);

  if (leakedKeys.length > 0) {
    log.security('FATAL: Secret variables still present in process.env after vault purge.', {
      leakedKeys,
      bootCorrelId,
    });
    log.error('Halting: environment security invariant violated.', { bootCorrelId });
    process.exit(1);
  }

  log.info('Post-vault audit passed. process.env contains no managed secrets.', {
    bootCorrelId,
  });

  // =========================================================================
  // STEP 4: Create restricted vault interface for the Orchestrator.
  // The orchestrator receives a proxy that allows ONLY issueToken,
  // verifyToken, and getScopes. All other vault operations are blocked.
  // =========================================================================
  log.info('Creating restricted vault interface.', { bootCorrelId });

  let vaultInterface;
  try {
    vaultInterface = createVaultInterface(vault);
  } catch (err) {
    log.error('FATAL: Could not create vault interface.', {
      reason:    err.message,
      bootCorrelId,
    });
    process.exit(1);
  }

  log.info('Vault interface created.', { bootCorrelId });

  // =========================================================================
  // STEP 5: Construct the AgentParameterManifest.
  // This is the sealed, immutable configuration object passed to the
  // Orchestrator. It packages all dependencies without exposing raw secrets.
  // =========================================================================
  log.info('Building AgentParameterManifest.', { bootCorrelId });

  const mailbox = new Mailbox();

  let agentManifest;
  try {
    agentManifest = buildManifest({
      agentRegistry:  AGENT_REGISTRY,
      kernelId:       KERNEL_ID,
      kernelVersion:  KERNEL_VERSION,
      agentsDir:      path.resolve(__dirname, '..', 'agents'),
      spawnPolicy:    {}, // Use all defaults from DEFAULT_SPAWN_POLICY.
      ipcConfig:      {
        queueCapacity:    500,
        dispatchBatch:    20,
        maxClockSkewMs:   300_000,
      },
      healthManifest:  manifest,
      mailbox,
      vaultInterface,
      metadata: {
        bootCorrelId,
        nodeVersion:  process.version,
        platform:     process.platform,
      },
    });
  } catch (err) {
    log.error('FATAL: AgentParameterManifest construction failed.', {
      reason:    err.message,
      bootCorrelId,
    });
    process.exit(1);
  }

  log.info('AgentParameterManifest sealed.', {
    bootCorrelId,
    summary: agentManifest.toSummary(),
  });

  // =========================================================================
  // STEP 6: Construct the Orchestrator with the manifest.
  // The Orchestrator receives the manifest and nothing else.
  // =========================================================================
  log.info('Constructing Orchestrator.', { bootCorrelId });

  let orchestrator;
  try {
    orchestrator = new Orchestrator(agentManifest);
  } catch (err) {
    log.error('FATAL: Orchestrator construction failed.', {
      reason:    err.message,
      bootCorrelId,
    });
    process.exit(1);
  }

  log.info('Orchestrator constructed.', { bootCorrelId });

  // =========================================================================
  // STEP 7: Wire lifecycle event bus observers.
  // External components subscribe here, BEFORE the orchestrator starts,
  // so no events are missed during boot.
  // =========================================================================
  log.info('Wiring lifecycle event bus observers.', { bootCorrelId });

  _wireBootObservers(bus, vault);

  log.info('Event bus observers wired.', { bootCorrelId });

  // =========================================================================
  // STEP 8: Start the orchestrator.
  // =========================================================================
  log.info('Starting orchestrator.', {
    bootPrepMs: Date.now() - startedAt,
    bootCorrelId,
  });

  try {
    await orchestrator.start();
  } catch (err) {
    log.error('FATAL: Orchestrator.start() failed.', {
      reason:    err.message,
      stack:     err.stack,
      bootCorrelId,
    });
    process.exit(1);
  }

  log.info('Boot sequence complete. Kernel is operational.', {
    totalBootMs: Date.now() - startedAt,
    bootCorrelId,
  });
}

// =============================================================================
// PRIVATE — EVENT BUS OBSERVERS
// =============================================================================

/**
 * Registers kernel-entry-level observers on the lifecycle event bus.
 * These observers handle cross-cutting concerns:
 *   - Vault sealing on kernel shutdown.
 *   - Top-level error logging for security events.
 *   - Placeholder integration points for the healer (Phase 4).
 *
 * @param {import('./src/lifecycle/lifecycle_event_bus').KlynLifecycleEventBus} bus
 * @param {object} vaultSingleton  The full vault (for sealing on shutdown).
 */
function _wireBootObservers(bus, vaultSingleton) {

  // --- Vault sealing on shutdown completion ---
  bus.once(LIFECYCLE_EVENT.KERNEL_SHUTDOWN_COMPLETE, (event) => {
    log.info('Kernel shutdown complete event received. Sealing vault.', {
      correlId:  (event as any).correlId,
      exitCode:  (event as any).payload?.exitCode,
    });
    try {
      vaultSingleton.seal();
      log.info('Vault sealed successfully.');
    } catch (err) {
      log.error('Error sealing vault during shutdown.', { reason: err.message });
    }
  }, { name: 'VaultSealOnShutdown' });

  // --- Agent fault observer (placeholder for Phase 4 Healer integration) ---
  bus.on(LIFECYCLE_EVENT.AGENT_FAULTED, (event) => {
    log.warn('Lifecycle event: AGENT_FAULTED observed at kernel entry.', {
      agentId:  (event as any).payload?.agentId,
      reason:   (event as any).payload?.reason,
      phase:    (event as any).payload?.phase,
      correlId: (event as any).correlId,
    });
    // Phase 4: healer.onFault((event as any).payload) will be registered here.
  }, { name: 'KernelEntryFaultObserver' });

  // --- Kernel ready observer ---
  bus.once(LIFECYCLE_EVENT.KERNEL_READY, (event) => {
    log.info('Lifecycle event: KERNEL_READY confirmed.', {
      kernelId:   (event as any).payload?.kernelId,
      agentCount: (event as any).payload?.agentCount,
      correlId:   (event as any).correlId,
    });
  }, { name: 'KernelReadyConfirm' });

  // --- IPC security rejection observer ---
  bus.on(LIFECYCLE_EVENT.IPC_MESSAGE_REJECTED, (event) => {
    log.security('Lifecycle event: IPC message rejected.', {
      agentId:  (event as any).payload?.agentId,
      code:     (event as any).payload?.code,
      reason:   (event as any).payload?.reason,
      correlId: (event as any).correlId,
    });
  }, { name: 'IPCRejectionSecurityObserver' });

  // --- Task completion observer ---
  bus.on(LIFECYCLE_EVENT.TASK_COMPLETED, (event) => {
    log.info('Lifecycle event: Task completed.', {
      agentId:  (event as any).payload?.agentId,
      taskId:   (event as any).payload?.taskId,
      correlId: (event as any).correlId,
    });
  }, { name: 'TaskCompletionObserver' });

  // --- Task failure observer ---
  bus.on(LIFECYCLE_EVENT.TASK_FAILED, (event) => {
    log.error('Lifecycle event: Task failed.', {
      agentId:  (event as any).payload?.agentId,
      taskId:   (event as any).payload?.taskId,
      correlId: (event as any).correlId,
    });
  }, { name: 'TaskFailureObserver' });
}

// =============================================================================
// BOOT-PHASE ERROR GUARDS
// =============================================================================

// These handlers catch failures during the boot sequence only.
// After the Orchestrator is constructed, it installs its own handlers
// and these once-handlers will have already fired or been deregistered.

process.once('unhandledRejection', (reason) => {
  log.error('UNHANDLED REJECTION during kernel boot.', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack:  reason instanceof Error ? reason.stack   : undefined,
  });
  process.exit(1);
});

process.once('uncaughtException', (err) => {
  log.error('UNCAUGHT EXCEPTION during kernel boot.', {
    reason: err.message,
    stack:  err.stack,
  });
  process.exit(1);
});

// =============================================================================
// EXECUTE BOOT
// =============================================================================

boot();


export {};
