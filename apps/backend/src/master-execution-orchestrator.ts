import type { ConsensusDecision, ConsensusProposal, ConsensusVote } from "../../../packages/cognitive-engine/src/consensus/AgentConsensusEngine.js";
import type { DeadlockCycle, DependencyEdge } from "../../../packages/cognitive-engine/src/consensus/DeadlockDetector.js";
import type { RecoveryResult, RecoveryState } from "../../../packages/cognitive-engine/src/consensus/SelfHealingStateResolver.js";
import type { CrossAgentKnowledgeBus, VectorSearchResult } from "@klyn/ai-engine";

export interface MasterEventBus {
  publish(topic: string, payload: unknown): Promise<unknown>;
}

export interface ConsensusAdapter<T> {
  beginProposal(proposal: ConsensusProposal<T>): void;
  castVote(vote: ConsensusVote<T>): void;
  decide(): ConsensusDecision<T> | undefined;
}

export interface DeadlockAdapter {
  detect(edges: readonly DependencyEdge[]): readonly DeadlockCycle[];
}

export interface RecoveryAdapter<T> {
  resolve(cycle: DeadlockCycle, safeState: RecoveryState<T>): Promise<RecoveryResult>;
}

export interface MasterExecutionInput<T = unknown> {
  executionId: string;
  namespace: string;
  context: string;
  proposal: ConsensusProposal<T>;
  votes: readonly ConsensusVote<T>[];
  dependencies?: readonly DependencyEdge[];
  safeState: RecoveryState<T>;
  memoryPayload: T;
  memoryTtlMs?: number;
  now?: number;
  retrievalK?: number;
}

export interface MasterExecutionResult<T = unknown> {
  executionId: string;
  memory: readonly VectorSearchResult<T>[];
  consensus?: ConsensusDecision<T>;
  deadlocks: readonly DeadlockCycle[];
  recoveries: readonly RecoveryResult[];
  completed: boolean;
}

/**
 * Phase 8.10 integration boundary: event ingress -> semantic memory -> quorum
 * consensus -> deterministic deadlock detection/recovery. Concrete engines are
 * injected so the backend remains decoupled from cognitive-engine packaging.
 */
export class MasterExecutionOrchestrator<T = unknown> {
  constructor(
    private readonly events: MasterEventBus,
    private readonly memory: CrossAgentKnowledgeBus<T>,
    private readonly consensus: ConsensusAdapter<T>,
    private readonly deadlocks: DeadlockAdapter,
    private readonly resolver: RecoveryAdapter<T>,
  ) {}

  async execute(input: MasterExecutionInput<T>): Promise<MasterExecutionResult<T>> {
    const now = input.now ?? Date.now();
    await this.events.publish("master.execution.dispatched", {
      executionId: input.executionId,
      namespace: input.namespace,
    });

    await this.memory.publish(
      {
        id: `${input.executionId}:context`,
        namespace: input.namespace,
        content: input.context,
        payload: input.memoryPayload,
        ttlMs: input.memoryTtlMs,
      },
      now,
    );

    const memory = await this.memory.query(
      input.namespace,
      input.context,
      input.retrievalK ?? 5,
      now,
    );

    this.consensus.beginProposal(input.proposal);
    for (const vote of input.votes) this.consensus.castVote(vote);
    const consensus = this.consensus.decide();

    const cycles = this.deadlocks.detect(input.dependencies ?? []);
    const recoveries: RecoveryResult[] = [];
    for (const cycle of cycles) {
      recoveries.push(await this.resolver.resolve(cycle, input.safeState));
    }

    const completed = consensus !== undefined && recoveries.length === cycles.length;
    await this.events.publish(
      completed ? "master.execution.completed" : "master.execution.blocked",
      {
        executionId: input.executionId,
        consensus: consensus !== undefined,
        deadlocks: cycles.length,
        recoveries: recoveries.length,
      },
    );

    return Object.freeze({
      executionId: input.executionId,
      memory,
      consensus,
      deadlocks: Object.freeze(cycles.slice()),
      recoveries: Object.freeze(recoveries.slice()),
      completed,
    });
  }
}
