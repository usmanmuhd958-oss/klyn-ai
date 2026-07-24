/**
 * =============================================================================
 * KLYN AI OS — Kernel Lifecycle Subsystem Index
 * File: kernel/src/lifecycle/index.js
 * Version: 1.0.0
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
 *   const {
 *     buildManifest,
 *     getEventBus,
 *     LIFECYCLE_EVENT,
 *     createVaultInterface,
 *     createKernelStateMachine,
 *     createAgentStateMachine,
 *     ShutdownCoordinator,
 *   } = require('./kernel/src/lifecycle');
 *
 * =============================================================================
 */
'use strict';
const { buildManifest, AgentParameterManifest, DEFAULT_SPAWN_POLICY, } = require('./agent_parameter_manifest');
const { getEventBus, KlynLifecycleEventBus, LIFECYCLE_EVENT, _resetBusForTesting, } = require('./lifecycle_event_bus');
const { createVaultInterface, ALLOWED_VAULT_OPERATIONS, } = require('./vault_interface');
const { KlynStateMachine, KERNEL_STATE, AGENT_STATE, KERNEL_TRANSITIONS, AGENT_TRANSITIONS, createKernelStateMachine, createAgentStateMachine, } = require('./kernel_state_machine');
const { ShutdownCoordinator, } = require('./shutdown_coordinator');
module.exports = Object.freeze({
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
});
export {};
