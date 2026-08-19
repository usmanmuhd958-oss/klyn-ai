export interface CognitiveState {
  id: string;

  goal: string;

  currentTask: string;

  activeAgents: string[];

  context: Record<string, unknown>;

  memories: string[];

  confidence: number;

  createdAt: Date;

  updatedAt: Date;
}

export class CognitiveStateManager {
  private state: CognitiveState;

  constructor() {
    this.state = {
      id: crypto.randomUUID(),
      goal: "",
      currentTask: "",
      activeAgents: [],
      context: {},
      memories: [],
      confidence: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  getState(): CognitiveState {
    return this.state;
  }

  updateGoal(goal: string): void {
    this.state.goal = goal;
    this.state.updatedAt = new Date();
  }

  addMemory(memory: string): void {
    this.state.memories.push(memory);
    this.state.updatedAt = new Date();
  }
}
