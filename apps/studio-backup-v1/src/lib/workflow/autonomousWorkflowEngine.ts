import type {
  ExecutionGraph,
  WorkflowTask,
} from "@/components/workflow/workflow.types";

export function createWorkflow(intent: string): ExecutionGraph {
  const now = Date.now();

  const tasks: WorkflowTask[] = [
    {
      id: "planner",
      name: "Analyze Intent",
      agent: "planner-agent",
      phase: "planning",
      status: "pending",
      createdAt: now,
    },
    {
      id: "executor",
      name: "Execute Changes",
      agent: "coder-agent",
      phase: "executing",
      status: "pending",
      createdAt: now,
    },
    {
      id: "validator",
      name: "Verify System",
      agent: "tester-agent",
      phase: "verifying",
      status: "pending",
      createdAt: now,
    },
    {
      id: "recovery",
      name: "Self Healing",
      agent: "recovery-agent",
      phase: "recovering",
      status: "pending",
      createdAt: now,
    },
  ];

  return {
    id: crypto.randomUUID(),
    intent,
    tasks,
    phase: "planning",
  };
}

export function advanceWorkflow(
  graph: ExecutionGraph,
): ExecutionGraph {

  const index =
    graph.tasks.findIndex(
      (t) => t.status === "pending"
    );

  if (index === -1) {
    return {
      ...graph,
      phase: "completed",
    };
  }

  const tasks = graph.tasks.map((task, i) =>
    i === index
      ? {
          ...task,
          status: "success" as const,
        }
      : task
  );

  return {
    ...graph,
    tasks,
  };
}
