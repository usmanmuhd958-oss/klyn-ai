// KLYN AI OS — workflow-engine package entrypoint.
export { LWWRegisterCRDT, CRDT_UPDATE_EVENT } from './crdt_sync.js';
export type { CRDTUpdate, CRDTStateEntry, CRDTMergeResult } from './crdt_sync.js';
// Phase 5: spec-driven in-memory E2E virtualization.
export { E2EVirtualizer, validateBody } from './e2e_virtualizer.js';
export type { VirtualRequest, VirtualResponse, VirtualSocket, VirtualizerStats } from './e2e_virtualizer.js';
// Phase 6: autonomous Git PR & release pipeline synthesis.
export { ReleasePipeline, bumpVersion, parseCommitMessage } from './auto_pr.js';
export type { CommitRecord, ChangelogEntry, ProofAttachment, PRPayload, StageResult, ReleaseVerdict } from './auto_pr.js';
export * from './WorkflowEngine.js';
export * from './AdvancedWorkflowEngine.js';
