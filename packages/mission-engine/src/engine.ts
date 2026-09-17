import { graphDigestInput, digestJson } from './crypto.js';
import { parseMissionEvidence, parseMissionGraph, validateGraphAcyclic, MissionValidationError } from './validation.js';
import type { EvidenceVerifier, MissionEvidence, MissionGraph, MissionNode, MissionSnapshot, MissionState, MissionEngineOptions, TransitionResult } from './types.js';

const ORDERED_STATES = [
  'ACTION_EXECUTED',
  'ARTIFACT_PRODUCED',
  'TEST_PASSED',
  'REQUIREMENT_VERIFIED',
  'DEPLOYMENT_CONFIRMED',
] as const;
type RequiredMissionState = (typeof ORDERED_STATES)[number];

const REQUIRED_EVIDENCE: Readonly<Record<RequiredMissionState, MissionEvidence['kind']>> = {
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
    if (expectedDigest !== graph.graphDigest) {
      throw new MissionValidationError('graphDigest does not match canonical graph contents');
    }
    if (graph.nodes.length !== ORDERED_STATES.length) {
      throw new MissionValidationError(`graph must contain exactly ${ORDERED_STATES.length} mission nodes`);
    }
    for (const state of ORDERED_STATES) {
      const matches = graph.nodes.filter((node) => node.state === state);
      if (matches.length !== 1) throw new MissionValidationError(`graph must contain exactly one node for ${state}`);
    }
    if (graph.nodes.some((node) => node.state === 'FAILED')) {
      throw new MissionValidationError('FAILED is an engine outcome, not a mission graph state');
    }
    for (let index = 0; index < ORDERED_STATES.length; index += 1) {
      const current = graph.nodes.find((node) => node.state === ORDERED_STATES[index]);
      const previous = index === 0 ? undefined : ORDERED_STATES[index - 1];
      if (!current) throw new MissionValidationError(`missing node for ${ORDERED_STATES[index]}`);
      const expectedDependency = previous === undefined ? [] : [this.nodeForStateFromGraph(graph, previous).nodeId];
      if (current.dependsOn.length !== expectedDependency.length || current.dependsOn.some((id, depIndex) => id !== expectedDependency[depIndex])) {
        throw new MissionValidationError(`${current.state} must depend only on ${expectedDependency.length === 0 ? 'no predecessor' : expectedDependency[0]}`);
      }
    }
    this.graph = graph;
  }

  public nodeForState(state: MissionState): MissionNode {
    return this.nodeForStateFromGraph(this.graph, state);
  }

  public requiredStateAfter(state: RequiredMissionState | 'NOT_STARTED'): RequiredMissionState {
    const index = state === 'NOT_STARTED' ? -1 : ORDERED_STATES.indexOf(state);
    if (index < 0) return ORDERED_STATES[0];
    const nextState = ORDERED_STATES[index + 1];
    if (nextState === undefined) throw new MissionTransitionError('mission is already complete');
    return nextState;
  }

  private nodeForStateFromGraph(graph: MissionGraph, state: MissionState): MissionNode {
    const node = graph.nodes.find((candidate) => candidate.state === state);
    if (!node) throw new MissionValidationError(`no node for state ${state}`);
    return node;
  }
}

export class MissionStateMachine {
  private readonly graph: VerifiableMissionGraph;
  private readonly verifier: EvidenceVerifier;
  private readonly nowEpochMs: () => number;
  private readonly evidenceById = new Map<string, MissionEvidence>();
  private currentState: RequiredMissionState | 'NOT_STARTED' = 'NOT_STARTED';
  private readonly completedNodeIds = new Set<string>();
  private readonly acceptedEvidenceIds = new Set<string>();
  private readonly satisfiedInvariantIds = new Set<string>();
  private blocked = false;

  public constructor(graph: VerifiableMissionGraph, options: MissionEngineOptions) {
    this.graph = graph;
    this.verifier = options.evidenceVerifier;
    this.nowEpochMs = options.nowEpochMs ?? (() => Date.now());
  }

  public static replay(graph: VerifiableMissionGraph, evidenceLog: readonly unknown[], options: MissionEngineOptions): MissionStateMachine {
    const machine = new MissionStateMachine(graph, options);
    for (const evidence of evidenceLog) machine.transition(evidence);
    return machine;
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
    if (this.blocked) throw new MissionTransitionError('mission is blocked after a failed transition');
    const evidence = parseMissionEvidence(input);
    const from = this.currentState;
    const to = this.graph.requiredStateAfter(from);
    const node = this.graph.nodeForState(to);
    this.validateTransition(evidence, node, from);
    this.evidenceById.set(evidence.evidenceId, evidence);
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

  private validateTransition(evidence: MissionEvidence, node: MissionNode, from: RequiredMissionState | 'NOT_STARTED'): void {
    if (evidence.missionId !== this.graph.graph.missionId || evidence.objectiveId !== this.graph.graph.objectiveId) {
      this.fail('evidence mission/objective identity mismatch');
    }
    if (evidence.nodeId !== node.nodeId) {
      this.fail(`evidence targets ${evidence.nodeId}, expected ${node.nodeId}`);
    }
    if (evidence.kind !== REQUIRED_EVIDENCE[node.state as RequiredMissionState]) {
      this.fail(`evidence kind ${evidence.kind} cannot advance ${node.state}`);
    }
    if (this.evidenceById.has(evidence.evidenceId)) {
      this.fail(`duplicate evidenceId: ${evidence.evidenceId}`);
    }
    if (evidence.verifierId !== this.verifier.verifierId) {
      this.fail('evidence verifier identity does not match the configured verifier');
    }
    if (evidence.issuedAtEpochMs > this.nowEpochMs()) {
      this.fail('evidence cannot be issued in the future');
    }
    if (!this.verifier.verify(evidence)) {
      this.fail('cryptographic evidence verification failed');
    }

    let predecessor: MissionEvidence | undefined;
    if (from === 'NOT_STARTED') {
      predecessor = undefined;
    } else {
      predecessor = this.latestEvidenceForState(from);
    }
    if (predecessor === undefined) {
      if (evidence.predecessorEvidenceIds.length !== 0) this.fail('first transition cannot reference predecessor evidence');
    } else {
      if (evidence.predecessorEvidenceIds.length !== 1 || evidence.predecessorEvidenceIds[0] !== predecessor.evidenceId) {
        this.fail(`evidence must reference exactly predecessor ${predecessor.evidenceId}`);
      }
      if (from !== 'NOT_STARTED' && !node.dependsOn.includes(this.graph.nodeForState(from).nodeId)) {
        this.fail(`graph dependency does not permit ${from} -> ${node.state}`);
      }
    }

    if (node.state === 'ACTION_EXECUTED' && evidence.artifactDigest !== undefined) {
      this.fail('action receipt cannot bind an artifact before artifact production');
    }
    if (node.state === 'ARTIFACT_PRODUCED') {
      if (evidence.artifactDigest === undefined) this.fail('artifact production requires artifactDigest');
      if (evidence.invariantIds.length !== node.invariantIds.length || !node.invariantIds.every((id) => evidence.invariantIds.includes(id))) {
        this.fail('artifact evidence invariant coverage is not exact');
      }
    }
    if (node.state === 'TEST_PASSED') {
      const producedArtifactDigest = this.latestArtifactDigest();
      if (producedArtifactDigest === undefined || evidence.artifactDigest !== producedArtifactDigest) {
        this.fail('test result must bind exactly to the produced artifact');
      }
      this.requireExactInvariantCoverage(evidence, node);
    }
    if (node.state === 'REQUIREMENT_VERIFIED') this.validateRequirementProof(evidence, node);
    if (node.state === 'DEPLOYMENT_CONFIRMED') this.validateDeploymentAttestation(evidence, node);
  }

  private validateRequirementProof(evidence: MissionEvidence, node: MissionNode): void {
    const testEvidence = this.latestEvidenceForState('TEST_PASSED');
    const artifactEvidence = this.latestEvidenceForState('ARTIFACT_PRODUCED');
    if (!testEvidence || !artifactEvidence) this.fail('requirement verification requires prior test and artifact evidence');
    if (evidence.predecessorEvidenceIds.length !== 1 || evidence.predecessorEvidenceIds[0] !== testEvidence.evidenceId) {
      this.fail('requirement proof must reference the passed test evidence');
    }
    if (evidence.artifactDigest !== artifactEvidence.artifactDigest) {
      this.fail('requirement proof must bind exactly to the produced artifact');
    }
    this.requireExactInvariantCoverage(evidence, node);
  }

  private validateDeploymentAttestation(evidence: MissionEvidence, node: MissionNode): void {
    const requirementEvidence = this.latestEvidenceForState('REQUIREMENT_VERIFIED');
    const artifactEvidence = this.latestEvidenceForState('ARTIFACT_PRODUCED');
    if (!requirementEvidence || !artifactEvidence) this.fail('deployment confirmation requires requirement verification');
    if (evidence.predecessorEvidenceIds.length !== 1 || evidence.predecessorEvidenceIds[0] !== requirementEvidence.evidenceId) {
      this.fail('deployment attestation must reference the requirement proof');
    }
    if (evidence.artifactDigest !== artifactEvidence.artifactDigest) {
      this.fail('deployment attestation must bind exactly to the verified artifact');
    }
    this.requireExactInvariantCoverage(evidence, node);
  }

  private requireExactInvariantCoverage(evidence: MissionEvidence, node: MissionNode): void {
    if (evidence.invariantIds.length !== node.invariantIds.length || !node.invariantIds.every((id) => evidence.invariantIds.includes(id))) {
      this.fail('evidence invariant coverage is not exact');
    }
  }

  private latestEvidenceForState(state: RequiredMissionState): MissionEvidence | undefined {
    const nodeId = this.graph.nodeForState(state).nodeId;
    return [...this.evidenceById.values()].find((evidence) => evidence.nodeId === nodeId);
  }

  private latestArtifactDigest(): string | undefined {
    return this.latestEvidenceForState('ARTIFACT_PRODUCED')?.artifactDigest;
  }

  private transitionReason(state: RequiredMissionState): string {
    if (state === 'TEST_PASSED') return 'test passed; requirement remains unverified until cryptographic requirement proof is accepted';
    if (state === 'REQUIREMENT_VERIFIED') return 'required mission invariants verified by cryptographically valid evidence';
    if (state === 'DEPLOYMENT_CONFIRMED') return 'deployment attested after requirement verification';
    return `${state} accepted with cryptographically valid evidence`;
  }

  private fail(message: string): never {
    this.blocked = true;
    throw new MissionTransitionError(message);
  }
}
