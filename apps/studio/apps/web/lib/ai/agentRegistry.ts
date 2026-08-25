export type AgentRole =
  | "architect"
  | "builder"
  | "reviewer"
  | "security"
  | "operator";

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  capabilities: string[];
  active: boolean;
}

const agents: AgentDefinition[] = [
  {
    id: "architect-agent",
    name: "Architect",
    role: "architect",
    description: "Designs system architecture and technical plans.",
    capabilities: [
      "architecture.design",
      "database.model",
      "api.design"
    ],
    active: true
  },
  {
    id: "builder-agent",
    name: "Builder",
    role: "builder",
    description: "Generates and modifies application code.",
    capabilities: [
      "code.generate",
      "code.modify",
      "artifact.create"
    ],
    active: true
  },
  {
    id: "reviewer-agent",
    name: "Reviewer",
    role: "reviewer",
    description: "Reviews implementation quality.",
    capabilities: [
      "code.review",
      "security.review"
    ],
    active: true
  },
  {
    id: "security-agent",
    name: "Security Guard",
    role: "security",
    description: "Validates security policies.",
    capabilities: [
      "security.scan",
      "permission.check"
    ],
    active: true
  },
  {
    id: "operator-agent",
    name: "Operator",
    role: "operator",
    description: "Handles deployment and operations.",
    capabilities: [
      "deployment.execute",
      "infrastructure.manage"
    ],
    active: true
  }
];

export class AgentRegistry {
  getAll() {
    return agents;
  }

  getById(id: string) {
    const agent = agents.find((agent) => agent.id === id);

    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    return agent;
  }

  getByCapability(capability: string) {
    return agents.filter((agent) =>
      agent.capabilities.includes(capability)
    );
  }
}

export const agentRegistry = new AgentRegistry();
