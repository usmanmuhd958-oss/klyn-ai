import { ConsensusArbitrator, type ArbitrationDecision } from "./ConsensusArbitrator.js";
import { EpistemicAuditEngine, type EpistemicAuditRecord } from "./EpistemicAuditEngine.js";
import { EvidenceGraphBuilder, type EvidenceGraph, type EvidenceObservation } from "./EvidenceGraphBuilder.js";
import { ClaimsVerifier, type ClaimsVerificationResult } from "./ClaimsVerifier.js";
import { ExecutionPlanner, type ExecutionStrategy } from "./ExecutionPlanner.js";
import { TaskGraphCompiler, type CompiledTaskGraph, type IntentGraphTask } from "./TaskGraphCompiler.js";
import { SwarmTaskDispatcher, type SwarmAgent, type SwarmDispatchResult, type SwarmExecutionContext } from "./SwarmTaskDispatcher.js";
import { GovernancePolicyEngine, type GovernanceEvaluation, type GovernanceRiskInput } from "./GovernancePolicyEngine.js";
import { PromotionController, type PromotionDecision, type PromotionSigner } from "./PromotionController.js";
import type { IntentSpec } from "./IntentSpec.js";

export interface GovernanceTaskExecution {
  readonly observations: readonly EvidenceObservation[];
  readonly value: string;
  readonly evidenceWeight: number;
}

export interface GovernanceExecutionAdapter {
  execute(task: IntentGraphTask, context: SwarmExecutionContext): Promise<GovernanceTaskExecution>;
}

export interface GovernanceOrchestratorOptions {
  readonly runtime: GovernanceExecutionAdapter;
  readonly risk: GovernanceRiskInput;
  readonly promotionTarget: string;
  readonly signer: PromotionSigner;
  readonly createdAt?: number;
  readonly agents?: readonly SwarmAgent[];
}

export interface GovernanceExecutionResult {
  readonly graph: CompiledTaskGraph;
  readonly strategy: ExecutionStrategy;
  readonly dispatch: SwarmDispatchResult;
  readonly observations: readonly EvidenceObservation[];
  readonly evidenceGraph: EvidenceGraph;
  readonly verification: ClaimsVerificationResult;
  readonly audit: EpistemicAuditRecord;
  readonly consensus: ArbitrationDecision<string>;
  readonly governance: GovernanceEvaluation;
  readonly promotion: PromotionDecision;
}

export class GovernanceOrchestratorError extends Error {
  readonly code = "GOVERNANCE_ORCHESTRATOR_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "GovernanceOrchestratorError";
  }
}

const DEFAULT_ROLES: readonly SwarmAgent["role"][] = ["ARCHITECT", "BUILDER", "VALIDATOR", "EVIDENCE"];

export class GovernanceOrchestrator {
  constructor(
    private readonly graphCompiler = new TaskGraphCompiler(),
    private readonly planner = new ExecutionPlanner(),
    private readonly dispatcher = new SwarmTaskDispatcher(),
    private readonly evidenceBuilder = new EvidenceGraphBuilder(),
    private readonly claimsVerifier = new ClaimsVerifier(),
    private readonly governancePolicy = new GovernancePolicyEngine(),
    private readonly clock: () => number = Date.now,
  ) {}

  async executeIntentToVerifiedReality(intent: IntentSpec, options: GovernanceOrchestratorOptions): Promise<GovernanceExecutionResult> {
    if (intent.state !== "FROZEN" && intent.state !== "EXECUTABLE") throw new GovernanceOrchestratorError(`Intent ${intent.intentId} is not executable`);

    const graph = this.graphCompiler.compile(intent);
    const strategy = this.planner.plan(intent, graph);
    const observations: EvidenceObservation[] = [];
    const agents = options.agents ?? this.defaultAgents(options.runtime, observations);
    const auditEngine = new EpistemicAuditEngine(`execution:${intent.intentId}`, intent.intentId);
    auditEngine.claim("Governance orchestration accepted the frozen intent");

    const dispatch = await this.dispatcher.dispatch(intent, graph, strategy, agents);
    const orderedObservations = Object.freeze([...observations].sort((a, b) => a.sequence - b.sequence || a.hash.localeCompare(b.hash)));
    auditEngine.observe(orderedObservations.length > 0 ? "Sandbox observations were collected" : "Execution completed without observations");

    const evidenceGraph = this.evidenceBuilder.build(intent, orderedObservations);
    const verification = this.claimsVerifier.verify(intent, evidenceGraph);
    const audit = auditEngine.prove(evidenceGraph, verification);

    const votes = dispatch.records.map((record) => ({
      agentId: record.agentId,
      role: record.role,
      state: record.status === "SUCCEEDED" ? "PASS" : "FAIL",
      evidenceWeight: record.evidenceWeight,
      epistemicState: record.epistemicState,
    } as const));
    const consensus = new ConsensusArbitrator<string>(Math.max(1, votes.length)).arbitrate(votes, 1, 1);
    const governance = this.governancePolicy.evaluate(intent, audit, options.risk, {
      disposition: consensus.disposition,
      weightedSupport: consensus.weightedSupport,
      weightedOpposition: consensus.weightedOpposition,
      quorum: consensus.quorum,
    });

    const promotionController = new PromotionController();
    promotionController.beginPrePromotionAudit();
    const promotion = promotionController.promote(intent, audit, governance, options.promotionTarget, options.signer, options.createdAt ?? this.clock());

    return Object.freeze({ graph, strategy, dispatch, observations: orderedObservations, evidenceGraph, verification, audit, consensus, governance, promotion });
  }

  private defaultAgents(runtime: GovernanceExecutionAdapter, observations: EvidenceObservation[]): readonly SwarmAgent[] {
    return Object.freeze(DEFAULT_ROLES.map((role, index) => Object.freeze({
      agentId: `${role.toLowerCase()}-${index + 1}`,
      role,
      execute: async (task: IntentGraphTask, context: SwarmExecutionContext) => {
        const execution = await runtime.execute(task, context);
        observations.push(...execution.observations);
        return {
          status: "SUCCEEDED" as const,
          epistemicState: "OBSERVED" as const,
          evidenceWeight: execution.evidenceWeight,
          value: execution.value,
        };
      },
    })));
  }
}
