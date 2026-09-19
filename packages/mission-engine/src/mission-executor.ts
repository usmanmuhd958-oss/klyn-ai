import type {
  MissionEvidence,
  MissionNode,
  MissionSnapshot,
  MissionState,
} from "./types.js";
import { MISSION_STATES } from "./types.js";
import { MissionStateMachine, VerifiableMissionGraph } from "./engine.js";

export interface MissionStepContext {
  readonly missionId: string;
  readonly objectiveId: string;
  readonly node: MissionNode;
  readonly signal: AbortSignal;
  readonly snapshot: MissionSnapshot;
}

export interface MissionStepExecutor<TOutput = unknown> {
  execute(context: MissionStepContext): Promise<TOutput>;
}

export interface MissionEvidenceFactory<TOutput = unknown> {
  create(input: {
    readonly node: MissionNode;
    readonly output: TOutput;
    readonly previous: MissionSnapshot;
  }): MissionEvidence;
}

export interface MissionExecutionResult<TOutput = unknown> {
  readonly missionId: string;
  readonly completed: boolean;
  readonly steps: readonly {
    readonly state: MissionState;
    readonly nodeId: string;
    readonly output: TOutput;
    readonly evidenceId: string;
  }[];
  readonly snapshot: MissionSnapshot;
}

export interface MissionExecutionRunnerOptions {
  readonly signal?: AbortSignal;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Mission execution aborted");
  }
}

export class MissionExecutionRunner<TOutput = unknown> {
  public constructor(
    private readonly graph: VerifiableMissionGraph,
    private readonly machine: MissionStateMachine,
    private readonly executor: MissionStepExecutor<TOutput>,
    private readonly evidenceFactory: MissionEvidenceFactory<TOutput>,
  ) {}

  public async run(options: MissionExecutionRunnerOptions = {}): Promise<MissionExecutionResult<TOutput>> {
    const signal = options.signal ?? new AbortController().signal;
    const steps: Array<{
      readonly state: MissionState;
      readonly nodeId: string;
      readonly output: TOutput;
      readonly evidenceId: string;
    }> = [];

    while (true) {
      assertNotAborted(signal);
      const previous = this.machine.snapshot();
      if (previous.currentState === "DEPLOYMENT_CONFIRMED") break;

      const nextState = this.graph.requiredStateAfter(previous.currentState);
      if (!MISSION_STATES.includes(nextState)) {
        throw new Error(`Mission state is not executable: ${nextState}`);
      }

      const node = this.graph.nodeForState(nextState);
      const output = await this.executor.execute({
        missionId: previous.missionId,
        objectiveId: this.graph.graph.objectiveId,
        node,
        signal,
        snapshot: previous,
      });
      assertNotAborted(signal);

      const evidence = this.evidenceFactory.create({
        node,
        output,
        previous,
      });
      const transition = this.machine.transition(evidence);

      steps.push(Object.freeze({
        state: transition.to,
        nodeId: transition.nodeId,
        output,
        evidenceId: transition.evidenceId,
      }));
    }

    return Object.freeze({
      missionId: this.graph.graph.missionId,
      completed: this.machine.snapshot().currentState === "DEPLOYMENT_CONFIRMED",
      steps: Object.freeze(steps),
      snapshot: this.machine.snapshot(),
    });
  }
}
