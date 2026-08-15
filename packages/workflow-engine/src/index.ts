// KLYN AI OS — workflow-engine package entrypoint.
export { LWWRegisterCRDT, CRDT_UPDATE_EVENT } from './crdt_sync.js';
export type { CRDTUpdate, CRDTStateEntry, CRDTMergeResult } from './crdt_sync.js';
// Phase 5: spec-driven in-memory E2E virtualization.
export { E2EVirtualizer, validateBody } from './e2e_virtualizer.js';
export type { VirtualRequest, VirtualResponse, VirtualSocket, VirtualizerStats } from './e2e_virtualizer.js';
export * from './WorkflowEngine.js';
export * from './AdvancedWorkflowEngine.js';
