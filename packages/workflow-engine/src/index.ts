// KLYN AI OS — workflow-engine package entrypoint.
export { LWWRegisterCRDT, CRDT_UPDATE_EVENT } from './crdt_sync.js';
export type { CRDTUpdate, CRDTStateEntry, CRDTMergeResult } from './crdt_sync.js';
export * from './WorkflowEngine.js';
export * from './AdvancedWorkflowEngine.js';
