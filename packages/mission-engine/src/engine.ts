import { graphDigestInput, digestJson } from './crypto.js';
import { parseMissionEvidence, parseMissionGraph, validateGraphAcyclic, MissionValidationError } from './validation.js';
import type { EvidenceVerifier, MissionEvidence, MissionGraph, MissionNode, MissionSnapshot, MissionState, MissionEngineOptions, TransitionResult } from './types.js';

const ORDERED_STATES: readonly MissionState[] = [
  'ACTION_EXECUTED',
  'ARTIFACT_PRODUCED',
  'TEST_PASSED',
  'REQUIREMENT_VERIFIED',
  'DEPLOYMENT_CONFIRMED',
];

const REQUIRED_EVIDENCE: Readonly<Record<MissionState, MissionEvidence['kind']>> = {
  ACTION_EXECUTED: 'action-receipt',
  ARTIFACT_PRODUCED: 'artifact-manifest',
  TEST_PASSED: 'test-result',
  REQUIREMENT_VERIFIED: 'requirement-proof',
  DEPLOYMENT_CONFIRMED: 'deployment-attestation',
};

export class MissionTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MissionTransitionError';
  }
}

export class VerifiableMissionGraph {
  public readonly graph: MissionGraph;

  public constructor(input: unknown) {
    const graph = parseMissionGraph(input);
    validateGraphAcyclic(graph);
    const expectedDigest = digestJson(graphDigestInput({
      schemaVersion: graph.schemaVersion,
      missionId: graph.missionId,
      objectiveId: graph.objectiveId,
      nodes: graph.nodes,
      invariants: graph.invariants,
    }));
    if (expectedDigest !== graph.graphDigest) throw new MissionValidationError('graphDigest does not match canonical graph contents');
    for (const state of ORDERED_STATES) {
      const matches = graph.nodes.filter((node) => node.state === state);
      if (matches.length !== 1) throw new MissionValidationError(`graph must contain exactly one node for ${state}`);
    }
    const nodeStates = new Set(graph.nodes.map((node) => node.state));
    if (nodeStates.has('FAILED')) throw new MissionValidationError('FAILED is an engine outcome, not a mission graph state');
    this.graph = graph;
  }

  public nodeForState(state: MissionState): MissionNode {
    const node = this.graph.nodes.find((candidate) => candidate.state === state);
    if (!node) throw new MissionValidationError(`no node for state ${state}`);
    return node;
  }

  public requiredStateAfter(state: MissionState | 'NOT_STARTED'): MissionState {
    const index = state === 'NOT_STARTED' ? -1 : ORDERED_STATES.indexOf(state);
    if (index < 0) return ORDERED_STATES[0];
    if (index >= ORDERED_STATES.length - 1) throw new MissionTransitionError('mission is already complete');
    return ORDERED_STATES[index + 1];
  }
}

export class MissionStateMachine {
  private readonly graph: VerifiableMissionGraph;
  private readonly verifier: EvidenceVerifier;
  private readonly nowEpochMs: () => number;
  private readonly evidence = new Map<string, MissionEvidence>();
  private currentState: MissionState | 'NOT_STARTED' = 'NOT_STARTED';
  private readonly completedNodeIds = new Set<string>();
  private readonly acceptedEvidenceIds = new Set<string>();
  private readonly satisfiedInvariantIds = new Set<string>();
  private blocked = false;

  public constructor(graph: VerifiableMissionGraph, options: MissionEngineOptions) {
    this.graph = graph;
    this.verifier = options.evidenceVerifier;
    this.nowEpochMs = options.nowEpochMs ?? (() => Date.now());
  }

  public snapshot(): MissionSnapshot {
    return Object.freeze({
      missionId: this.graph.graph.missionId,
      currentState: this.currentState,
      completedNodeIds: Object.freeze([...this.completedNodeIds]),
      evidenceIds: Object.freeze([...this.acceptedEvidenceIds]),
      satisfiedInvariantIds: Object.freeze([...this.satisfiedInvariantIds]),
      blocked: this.blocked,
    });
  }

  public transition(input: unknown): TransitionResult {
    const evidence = parseMissionEvidence(input);
    const from = this.currentState;
    const to = this.graph.requiredStateAfter(from);
    const node = this.graph.nodeForState(to);
    this.validateTransition(evidence, node, from);
    this.evidence.set(evidence.evidenceId, evidence);
    this.acceptedEvidenceIds.add(evidence.evidenceId);
    this.completedNodeIds.add(node.nodeId);
    for (const invariantId of node.invariantIds) this.satisfiedInvariantIds.add(invariantId);
    this.currentState = to;
    return Object.freeze({
      accepted: true,
      from,
      to,
      nodeId: node.nodeId,
      evidenceId: evidence.evidenceId,
      reason: this.transitionReason(to),
      snapshot: this.snapshot(),
    });
  }

  private validateTransition(evidence: MissionEvidence, node: MissionNode, from: MissionState | 'NOT_STARTED'): void {
    if (this.blocked) throw new MissionTransitionError('mission is blocked after a failed transition');
    if (evidence.missionId !== this.graph.graph.missionId || evidence.objectiveId !== this.graph.graph.objectiveId) {
      this.blocked = true;
      throw new MissionTransitionError('evidence mission/objective identity mismatch');
    }
    if (evidence.nodeId !== node.nodeId) {
      this.blocked = true;
      throw new MissionTransitionError(`evidence targets ${evidence.nodeId}, expected ${node.nodeId}`);
    }
    if (evidence.kind !== REQUIRED_EVIDENCE[node.state]) {
      this.blocked = true;
      throw new MissionTransitionError(`evidence kind ${evidence.kind} cannot advance ${node.state}`);
    }
    if (this.evidence.has(evidence.evidenceId)) {
      this.blocked = true;
      throw new MissionTransitionError(`duplicate evidenceId: ${evidence.evidenceId}`);
    }
    if (!this.verifier.verify(evidence)) {
      this.blocked = true;
      throw new MissionTransitionError('cryptographic evidence verification failed');
    }
    const expectedDependency = from === 'NOT_STARTED' ? undefined : this.graph.nodeForState(from).nodeId;
    if (expectedDependency !== undefined && !node.dependsOn.includes(expectedDependency)) {
      this.blocked = true;
      throw new MissionTransitionError(`graph dependency does not permit ${from} -> ${node.state}`);
    }
    for (const predecessorId of evidence.predecessorEvidenceIds) {
      if (!this.acceptedEvidenceIds.has(predecessorId)) {
        this.blocked = true;
        throw new MissionTransitionError(`predecessor evidence is not accepted: ${predecessorId}`);
      }
    }
    const expectedPredecessor = this.latestEvidenceForState(from);
    if (expectedPredecessor !== undefined && !evidence.predecessorEvidenceIds.includes(expectedPredecessor.evidenceId)) {
      this.blocked = true;
      throw new MissionTransitionError(`evidence must bind to predecessor ${expectedPredecessor.evidenceId}`);
    }
    if (node.state === 'REQUIREMENT_VERIFIED') this.validateRequirementProof(evidence, node);
    if (node.state === 'DEPLOYMENT_CONFIRMED') this.validateDeploymentAttestation(evidence, node);
    if (node.state === 'ARTIFACT_PRODUCED' && evidence.artifactDigest === undefined) {
      this.blocked = true;
      throw new MissionTransitionError('artifact production requires artifactDigest');
    }
    if (node.state === 'TEST_PASSED' && evidence.artifactDigest !== this.latestArtifactDigest()) {
      this.blocked = true;
      throw new MissionTransitionError('test result must bind to the produced artifact');
    }
  }

  private validateRequirementProof(evidence: MissionEvidence, node: MissionNode): void {
    const testEvidence = this.latestEvidenceForState('TEST_PASSED');
    const artifactEvidence = this.latestEvidenceForState('ARTIFACT_PRODUCED');
    if (!testEvidence || !artifactEvidence) {
      this.blocked = true;
      throw new MissionTransitionError('requirement verification requires prior test and artifact evidence');
    }
    if (!evidence.predecessorEvidenceIds.includes(testEvidence.evidenceId)) {
      this.blocked = true;
      throw new MissionTransitionError('requirement proof must explicitly reference the passed test evidence');
    }
    if (evidence.artifactDigest !== artifactEvidence.artifactDigest) {
      this.blocked = true;
      throw new MissionTransitionError('requirement proof must bind to the produced artifact');
    }
    if (!node.invariantIds.every((id) => evidence.invariantIds.includes(id))) {
      this.blocked = true;
      throw new MissionTransitionError('requirement proof does not cover every required invariant');
    }
  }

  private validateDeploymentAttestation(evidence: MissionEvidence, node: MissionNode): void {
    const requirementEvidence = this.latestEvidenceForState('REQUIREMENT_VERIFIED');
    if (!requirementEvidence) {
      this.blocked = true;
      throw new MissionTransitionError('deployment confirmation requires requirement verification');
    }
    if (!evidence.predecessorEvidenceIds.includes(requirementEvidence.evidenceId)) {
      this.blocked = true;
      throw new MissionTransitionError('deployment attestation must reference requirement proof');
    }
    if (!node.invariantIds.every((id) => evidence.invariantIds.includes(id))) {
      this.blocked = true;
      throw new MissionTransitionError('deployment attestation does not cover deployment invariants');
    }
  }

  private latestEvidenceForState(state: MissionState | 'NOT_STARTED'): MissionEvidence | undefined {
    if (state === 'NOT_STARTED') return undefined;
    const nodeId = this.graph.nodeForState(state).nodeId;
    return [...this.evidence.values()].find((evidence) => evidence.nodeId === nodeId);
  }

  private latestArtifactDigest(): string | undefined {
    return this.latestEvidenceForState('ARTIFACT_PRODUCED')?.artifactDigest;
  }

  private transitionReason(state: MissionState): string {
    if (state === 'TEST_PASSED') return 'test passed; requirement remains unverified until cryptographic requirement proof is accepted';
    if (state === 'REQUIREMENT_VERIFIED') return 'required invariants verified by cryptographically valid evidence';
    if (state === 'DEPLOYMENT_CONFIRMED') return 'deployment attested after requirement verification';
    return `${state} accepted with cryptographically valid evidence`;
  }
}
