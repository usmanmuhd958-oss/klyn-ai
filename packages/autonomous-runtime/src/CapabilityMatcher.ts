export interface Capability {
  id: string;
  name: string;
  description: string;
  requiredTools: string[];
  confidence: number;
}

export interface AgentCapability {
  agentId: string;
  capabilities: Capability[];
}

export class CapabilityMatcher {
  private agents: AgentCapability[] = [];

  registerAgent(agent: AgentCapability): void {
    this.agents.push(agent);
  }

  findCapability(
    requirement: string
  ): AgentCapability | null {

    for (const agent of this.agents) {
      const match = agent.capabilities.find(cap =>
        cap.name
          .toLowerCase()
          .includes(requirement.toLowerCase())
      );

      if (match) {
        return agent;
      }
    }

    return null;
  }

  listCapabilities(): Capability[] {
    return this.agents.flatMap(
      agent => agent.capabilities
    );
  }
}
