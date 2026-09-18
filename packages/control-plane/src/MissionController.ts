import { signEvidence, type MissionEvidence, type VerifiableMissionGraph } from "@klyn/mission-engine";
import { type KeyObject } from "node:crypto";
import type { GovernanceEngine, EvidenceRecord } from "@klyn/governance";
import type {
  ControlPlaneExecutionRequest,
  EvidenceTransitionResult,
  MissionControllerOptions,
  MissionEvidenceAttestor,
  MissionEvidenceDraft,
  MissionRunResult,
} from "./types.js";

function governanceEvidence(evidence: MissionEvidence): EvidenceRecord {
  return Object.freeze({
    evidenceId: evidence.evidenceId,
    objectiveId: evidence.objectiveId,
    kind: "cryptographic-proof",
    statement: evidence.statement,
    source: "mission-engine/" + evidence.kind,
    payloadDigest: evidence.payloadDigest,
    invariantIds: Object.freeze([...evidence.invariantIds]),
    verificationStatus: "verified",
    verifierId: evidence.verifierId,
    collectedAtEpochMs: evidence.issuedAtEpochMs,
  });
}

export class MissionEvidenceAttestor implements MissionEvidenceAttestor {
  public readonly verifierId: string;

  public constructor(verifierId: string, private readonly privateKey: KeyObject) {
    if (!verifierId.trim()) throw new Error("verifierId is required");
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new TypeError("mission evidence signing requires an Ed25519 private key");
    }
    this.verifierId = verifierId;
  }

  public attest(draft: MissionEvidenceDraft): MissionEvidence {
    if (draft.verifierId !== this.verifierId) {
      throw new Error("evidence verifierId does not match configured attestor");
    }
    const signed = signEvidence(draft, this.privateKey);
    return Object.freeze({ ...draft, ...signed });
  }
}

export class MissionBoundaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MissionBoundaryError";
  }
}

export class MissionController {
  private readonly graph: VerifiableMissionGraph;

  public constructor(private readonly options: MissionControllerOptions) {
    this.graph = {
      graph: options.missionGraph,
      nodeForState: () => {
        throw new MissionBoundaryError("mission graph lookup is unavailable through this boundary");
      },
      requiredStateAfter: () => {
        throw new MissionBoundaryError("mission state transition helper is unavailable through this boundary");
      },
    } as unknown as VerifiableMissionGraph;
    void this.options;
  }

  public snapshot() {
    return this.options.missionStateMachine.snapshot();
  }

  public async run(input: ControlPlaneExecutionRequest): Promise<MissionRunResult> {
    if (input.intent.missionId !== this.options.missionGraph.missionId) {
      throw new MissionBoundaryError("intent missionId does not match mission graph");
    }
    if (input.intent.objectiveId !== this.options.missionGraph.objectiveId) {
      throw new MissionBoundaryError("intent objectiveId does not match mission graph");
    }

    const execution = await this.options.execution.execute(input);
    const snapshot = this.options.missionStateMachine.snapshot();

    if (execution.runtime.status !== "SUCCEEDED_VERIFIED") {
      return Object.freeze({
        mission: snapshot,
        intent: input.intent,
        execution,
      });
    }

    if (snapshot.currentState !== "NOT_STARTED") {
      throw new MissionBoundaryError(
        "mission already progressed; submit independently attested evidence with advanceWithEvidence()",
      );
    }

    const firstNode = this.options.missionGraph.nodes.find((node) => node.state === "ACTION_EXECUTED");
    if (firstNode === undefined) throw new MissionBoundaryError("mission graph has no ACTION_EXECUTED node");

    const draft: MissionEvidenceDraft = Object.freeze({
      evidenceId: input.authorizationRequest.requestId + ":action",
      missionId: input.intent.missionId,
      objectiveId: input.intent.objectiveId,
      nodeId: firstNode.nodeId,
      kind: "action-receipt",
      statement: "Runtime execution verified for task " + input.task.taskId,
      invariantIds: Object.freeze([]),
      predecessorEvidenceIds: Object.freeze([]),
      issuedAtEpochMs: this.now(),
      verifierId: this.options.evidenceAttestor.verifierId,
    });

    const transitioned = this.advanceWithEvidence(draft);
    return Object.freeze({
      mission: transitioned.transition.snapshot,
      intent: input.intent,
      execution,
      transition: transitioned.transition,
    });
  }

  public advanceWithEvidence(draft: MissionEvidenceDraft): EvidenceTransitionResult {
    const evidence = this.options.evidenceAttestor.attest(draft);
    const transition = this.options.missionStateMachine.transition(evidence);

    try {
      this.options.governance.recordEvidence(governanceEvidence(evidence));
    } catch (error: unknown) {
      throw new MissionBoundaryError(
        "mission transition committed but governance evidence recording failed: " + String(error),
      );
    }

    return Object.freeze({ evidence, transition });
  }

  private now(): number {
    return this.options.nowEpochMs?.() ?? Date.now();
  }
}

export type { MissionEvidence };
