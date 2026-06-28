import { AgentRuntime } from "../../agent-runtime/src/runtime/AgentRuntime";
import { WorkflowEngine } from "../../workflow-engine/src/WorkflowEngine";
import { AgentTask } from "../../agent-runtime/src/types/agent.types";

export type ExecutionMode = "runtime" | "workflow";

export interface OrchestratorRequest {
  id: string;
  input: string;
  mode?: ExecutionMode;
  workflow?: any;
}

export class AIOrchestrator {
  private runtime = new AgentRuntime();
  private workflowEngine = new WorkflowEngine();

  async execute(request: OrchestratorRequest) {
    const mode = this.selectMode(request);

    if (mode === "runtime") {
      return this.handleRuntime(request);
    }

    return this.handleWorkflow(request);
  }

  // -------------------------
  // INTELLIGENT ROUTING LOGIC
  // -------------------------
  private selectMode(request: OrchestratorRequest): ExecutionMode {
    if (request.mode) return request.mode;

    // intelligent decision layer
    const complexKeywords = [
      "deploy",
      "multi",
      "pipeline",
      "system",
      "architecture",
      "workflow",
    ];

    const isComplex = complexKeywords.some((k) =>
      request.input.toLowerCase().includes(k)
    );

    return isComplex ? "workflow" : "runtime";
  }

  // -------------------------
  // SIMPLE EXECUTION PATH
  // -------------------------
  private async handleRuntime(request: OrchestratorRequest) {
    const task: AgentTask = {
      id: request.id,
      projectId: "klyn-ai",
      input: request.input,
    };

    return this.runtime.run(task);
  }

  // -------------------------
  // COMPLEX EXECUTION PATH
  // -------------------------
  private async handleWorkflow(request: OrchestratorRequest) {
    if (!request.workflow) {
      throw new Error("Workflow definition required for workflow mode");
    }

    return this.workflowEngine.run(request.workflow, {
      id: request.id,
      input: request.input,
    });
  }
}
