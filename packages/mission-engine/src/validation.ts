import type { MissionEvidence, MissionGraph, MissionInvariant, MissionNode, MissionState } from './types.js';
import { EVIDENCE_KINDS, MISSION_SCHEMA_VERSION, MISSION_STATES } from './types.js';

export class MissionValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MissionValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new MissionValidationError(`${field} must be a non-empty string`);
  return value;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new MissionValidationError(`${field} must be an array of non-empty strings`);
  }
  return Object.freeze([...value]);
}

function requireState(value: unknown, field: string): MissionState {
  if (typeof value !== 'string' || !MISSION_STATES.includes(value as MissionState)) {
    throw new MissionValidationError(`${field} is not a supported mission state`);
  }
  return value as MissionState;
}

export function parseMissionGraph(input: unknown): MissionGraph {
  if (!isRecord(input)) throw new MissionValidationError('mission graph must be an object');
  if (input.schemaVersion !== MISSION_SCHEMA_VERSION) throw new MissionValidationError('unsupported mission graph schema version');
  const missionId = requireString(input.missionId, 'missionId');
  const objectiveId = requireString(input.objectiveId, 'objectiveId');
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new MissionValidationError('nodes must be non-empty');
  if (!Array.isArray(input.invariants)) throw new MissionValidationError('invariants must be an array');
  const nodes: MissionNode[] = input.nodes.map((raw, index) => {
    if (!isRecord(raw)) throw new MissionValidationError(`nodes[${index}] must be an object`);
    return Object.freeze({
      nodeId: requireString(raw.nodeId, `nodes[${index}].nodeId`),
      state: requireState(raw.state, `nodes[${index}].state`),
      invariantIds: requireStringArray(raw.invariantIds, `nodes[${index}].invariantIds`),
      dependsOn: requireStringArray(raw.dependsOn, `nodes[${index}].dependsOn`),
    });
  });
  const invariants: MissionInvariant[] = input.invariants.map((raw, index) => {
    if (!isRecord(raw)) throw new MissionValidationError(`invariants[${index}] must be an object`);
    return Object.freeze({
      invariantId: requireString(raw.invariantId, `invariants[${index}].invariantId`),
      statement: requireString(raw.statement, `invariants[${index}].statement`),
    });
  });
  if (typeof input.graphDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.graphDigest)) {
    throw new MissionValidationError('graphDigest must be a SHA-256 hex digest');
  }
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const invariantIds = new Set(invariants.map((invariant) => invariant.invariantId));
  if (nodeIds.size !== nodes.length) throw new MissionValidationError('duplicate nodeId');
  if (invariantIds.size !== invariants.length) throw new MissionValidationError('duplicate invariantId');
  for (const node of nodes) {
    for (const dependency of node.dependsOn) if (!nodeIds.has(dependency)) throw new MissionValidationError(`unknown dependency: ${dependency}`);
    for (const invariantId of node.invariantIds) if (!invariantIds.has(invariantId)) throw new MissionValidationError(`unknown invariant: ${invariantId}`);
  }
  return Object.freeze({ schemaVersion: MISSION_SCHEMA_VERSION, missionId, objectiveId, nodes: Object.freeze(nodes), invariants: Object.freeze(invariants), graphDigest: input.graphDigest });
}

export function parseMissionEvidence(input: unknown): MissionEvidence {
  if (!isRecord(input)) throw new MissionValidationError('mission evidence must be an object');
  const kind = input.kind;
  if (typeof kind !== 'string' || !EVIDENCE_KINDS.includes(kind as MissionEvidence['kind'])) throw new MissionValidationError('unsupported evidence kind');
  const issuedAtEpochMs = input.issuedAtEpochMs;
  if (typeof issuedAtEpochMs !== 'number' || !Number.isSafeInteger(issuedAtEpochMs) || issuedAtEpochMs < 0) throw new MissionValidationError('issuedAtEpochMs must be a non-negative safe integer');
  const payloadDigest = input.payloadDigest;
  if (typeof payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(payloadDigest)) throw new MissionValidationError('payloadDigest must be a SHA-256 hex digest');
  if (input.signatureBase64 !== undefined && (typeof input.signatureBase64 !== 'string' || input.signatureBase64.length === 0)) throw new MissionValidationError('signatureBase64 must be non-empty when provided');
  const evidence: MissionEvidence = {
    evidenceId: requireString(input.evidenceId, 'evidenceId'),
    missionId: requireString(input.missionId, 'missionId'),
    objectiveId: requireString(input.objectiveId, 'objectiveId'),
    nodeId: requireString(input.nodeId, 'nodeId'),
    kind: kind as MissionEvidence['kind'],
    statement: requireString(input.statement, 'statement'),
    payloadDigest,
    ...(input.artifactDigest === undefined ? {} : { artifactDigest: requireString(input.artifactDigest, 'artifactDigest') }),
    invariantIds: requireStringArray(input.invariantIds, 'invariantIds'),
    predecessorEvidenceIds: requireStringArray(input.predecessorEvidenceIds, 'predecessorEvidenceIds'),
    issuedAtEpochMs,
    verifierId: requireString(input.verifierId, 'verifierId'),
    ...(input.signatureBase64 === undefined ? {} : { signatureBase64: input.signatureBase64 }),
  };
  return Object.freeze(evidence);
}

export function validateGraphAcyclic(graph: MissionGraph): void {
  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new MissionValidationError('mission graph contains a dependency cycle');
    if (visited.has(nodeId)) return;
    const node = byId.get(nodeId);
    if (!node) throw new MissionValidationError(`unknown node: ${nodeId}`);
    visiting.add(nodeId);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of graph.nodes) visit(node.nodeId);
}
