async execute(task: string, workspaceId: string) {

  // DO NOT use pipeline logic inside constructor misuse
  // Instead use clean execution call

  const aiResult = await this.router.route({
    task,
    type: "reasoning",
    complexity: "high",
  });

  const agentResult = await this.runtime.run({
    agentId: "kernel-agent",
    role: "planner",
    taskId: `task-${Date.now()}`,
    workspaceId,
    input: aiResult.output,
  });

  return {
    task,
    aiResult,
    agentResult,
    status: "completed",
    timestamp: new Date().toISOString(),
  };
}
