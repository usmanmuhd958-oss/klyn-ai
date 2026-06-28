export type AgentType =
  | "planner"
  | "research"
  | "coder"
  | "reviewer"
  | "security"
  | "deployment"
  | "docs";

export interface Task {
  id: string;
  input: string;
  context?: any;
}

export interface AgentResult {
  agent: AgentType;
  output: any;
}

export class Orchestrator {
  async execute(task: Task) {
    // STEP 1: create execution plan
    const plan = await this.plan(task.input);

    // STEP 2: execute agents sequentially
    let context: any = { task, plan };

    const pipeline: AgentType[] = [
      "planner",
      "research",
      "coder",
      "reviewer",
      "security",
      "deployment",
      "docs",
    ];

    const results: AgentResult[] = [];

    for (const agent of pipeline) {
      const result = await this.runAgent(agent, context);

      results.push({
        agent,
        output: result,
      });

      context = {
        ...context,
        last: result,
      };
    }

    return {
      taskId: task.id,
      results,
      status: "completed",
    };
  }

  private async plan(input: string) {
    return {
      steps: input.split(" "),
      complexity: "high",
    };
  }

  private async runAgent(agent: AgentType, context: any) {
    // placeholder for real AI + Supabase + model routing
    return {
      agent,
      message: `Executed ${agent}`,
      context,
    };
  }
}
