import type { AgentDefinition } from "./agentRegistry";

export type AgentAction =
  | "architecture.design"
  | "database.model"
  | "api.design"
  | "code.generate"
  | "code.modify"
  | "artifact.create"
  | "code.review"
  | "security.scan"
  | "deployment.execute"
  | "infrastructure.manage";

export interface AgentContext {
  workspaceId: string;
  userId: string;
  agent: AgentDefinition;
}

const restrictedActions: AgentAction[] = [
  "deployment.execute",
  "infrastructure.manage"
];

export class AgentPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPermissionError";
  }
}

export function checkAgentPermission(
  context: AgentContext,
  action: AgentAction
): boolean {
  if (!context.agent.active) {
    throw new AgentPermissionError("Agent is disabled");
  }

  if (!context.agent.capabilities.includes(action)) {
    throw new AgentPermissionError(
      `Agent ${context.agent.name} cannot perform ${action}`
    );
  }

  if (
    restrictedActions.includes(action) &&
    context.agent.role !== "operator"
  ) {
    throw new AgentPermissionError(
      "Restricted infrastructure operation"
    );
  }

  return true;
}
