/**
 * =============================================================================
 * KLYN AI OS — Kernel Lifecycle Subsystem Index
 * File: kernel/src/lifecycle/index.js
 * Version: 2.0.0
 * Phase: 3 — Kernel Lifecycle Isolation
 * =============================================================================
 *
 * PURPOSE:
 *   Provides a single, clean import surface for all Phase 3 lifecycle
 *   components. Consumers import from this index rather than from individual
 *   files, allowing internal module structure to change without requiring
 *   updates to every consumer import path.
 *
 * USAGE:
 *   import {
 *     buildManifest,
 *     getEventBus,
 *     LIFECYCLE_EVENT,
 *     createVaultInterface,
 *     createKernelStateMachine,
 *     createAgentStateMachine,
 *     ShutdownCoordinator,
 *   } from './kernel/src/lifecycle/index.js';
 *
 * =============================================================================
 */

'use strict';

import {
  buildManifest,
  AgentParameterManifest,
  DEFAULT_SPAWN_POLICY,
} from './agent_parameter_manifest.js';

import {
  getEventBus,
  KlynLifecycleEventBus,
  LIFECYCLE_EVENT,
  _resetBusForTesting,
} from './lifecycle_event_bus.js';

import {
  createVaultInterface,
  ALLOWED_VAULT_OPERATIONS,
} from './vault_interface.js';

import {
  KlynStateMachine,
  KERNEL_STATE,
  AGENT_STATE,
  KERNEL_TRANSITIONS,
  AGENT_TRANSITIONS,
  createKernelStateMachine,
  createAgentStateMachine,
} from './kernel_state_machine.js';

import {
  ShutdownCoordinator,
} from './shutdown_coordinator.js';

export {
  // Manifest
  buildManifest,
  AgentParameterManifest,
  DEFAULT_SPAWN_POLICY,

  // Event Bus
  getEventBus,
  KlynLifecycleEventBus,
  LIFECYCLE_EVENT,
  _resetBusForTesting,

  // Vault Interface
  createVaultInterface,
  ALLOWED_VAULT_OPERATIONS,

  // State Machine
  KlynStateMachine,
  KERNEL_STATE,
  AGENT_STATE,
  KERNEL_TRANSITIONS,
  AGENT_TRANSITIONS,
  createKernelStateMachine,
  createAgentStateMachine,

  // Shutdown Coordinator
  ShutdownCoordinator,
};
