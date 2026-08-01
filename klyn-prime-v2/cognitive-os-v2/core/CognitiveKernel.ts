export interface CognitiveState {
  goal: string;
  context: Record<string, unknown>;
  confidence: number;
  decisions: string[];
}

export class CognitiveKernel {

  private state: CognitiveState;

  constructor() {
    this.state = {
      goal: "",
      context: {},
      confidence: 0,
      decisions: []
    };
  }

  initialize(goal: string) {
    this.state.goal = goal;
    this.state.confidence = 0.5;

    console.log(
      `[COGNITIVE KERNEL] Goal initialized: ${goal}`
    );
  }


  updateContext(
    key: string,
    value: unknown
  ) {
    this.state.context[key] = value;
  }


  makeDecision(decision: string) {

    this.state.decisions.push(decision);

    this.state.confidence =
      Math.min(
        this.state.confidence + 0.05,
        1
      );

    return {
      decision,
      confidence: this.state.confidence
    };
  }


  getState() {
    return this.state;
  }
}
