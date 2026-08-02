import { Agent } from "./Agent";
import { AgentIdentity } from "./AgentIdentity";
import { AgentCapability } from "./AgentCapability";
import { AgentProfile } from "./AgentProfile";
import { InputValidator, ValidationResult } from "../../security/InputValidator";
import { AuditLogger } from "../../security/AuditLogger";

export interface FactoryResult {
  agent: Agent | null;
  profile: AgentProfile | null;
  errors: string[];
}

export class AgentFactory {
  private static readonly auditLogger = AuditLogger.getInstance();
  private static readonly MAX_CAPABILITIES = 32;
  private static readonly MAX_NAME_LENGTH = 256;

  static createAgent(
    identity: AgentIdentity,
    capability: AgentCapability,
    principal: string = "system"
  ): FactoryResult {
    const idValidation = InputValidator.validateAgentId(identity.id);
    if (!idValidation.valid) {
      AgentFactory.auditLogger.log({
        principal,
        action: "agent.factory.create",
        resource: identity.id,
        outcome: "denied",
        metadata: { errors: idValidation.errors },
      });
      return { agent: null, profile: null, errors: idValidation.errors };
    }

    if (!identity.name || identity.name.length > AgentFactory.MAX_NAME_LENGTH) {
      return {
        agent: null,
        profile: null,
        errors: [`Agent name must be 1-${AgentFactory.MAX_NAME_LENGTH} characters`],
      };
    }

    if (!capability.skills || capability.skills.length === 0) {
      return {
        agent: null,
        profile: null,
        errors: ["Agent must declare at least one capability"],
      };
    }

    if (capability.skills.length > AgentFactory.MAX_CAPABILITIES) {
      return {
        agent: null,
        profile: null,
        errors: [`Agent cannot declare more than ${AgentFactory.MAX_CAPABILITIES} capabilities`],
      };
    }

    for (const skill of capability.skills) {
      const skillValidation = InputValidator.validateAgentId(skill);
      if (!skillValidation.valid) {
        return {
          agent: null,
          profile: null,
          errors: [`Invalid capability identifier: ${skill}`],
        };
      }
    }

    const profile: AgentProfile = {
      id: identity.id,
      name: identity.name,
      role: identity.role,
      capabilities: capability.skills,
      reputation: 0,
    };

    const agent = new Agent(identity, capability, principal);

    AgentFactory.auditLogger.log({
      principal,
      action: "agent.factory.create",
      resource: identity.id,
      outcome: "success",
      metadata: { role: identity.role, capabilities: capability.skills.length },
    });

    return { agent, profile, errors: [] };
  }
}
