import { AgentProfile } from "./AgentProfile";
import { InputValidator, ValidationResult } from "../../security/InputValidator";
import { AuditLogger } from "../../security/AuditLogger";

export interface RegistrationResult {
  success: boolean;
  agentId: string;
  errors: string[];
}

export class AgentRegistry {
  private static readonly auditLogger = AuditLogger.getInstance();
  private static readonly MAX_AGENTS = 10000;
  private static readonly ALLOWED_ROLES = new Set([
    "ARCHITECT",
    "CODER",
    "DEBUGGER",
    "REVIEWER",
    "TESTER",
    "DEPLOYER",
    "MONITOR",
    "ANALYST",
  ]);

  private agents: Map<string, AgentProfile> = new Map();
  private roleIndex: Map<string, Set<string>> = new Map();

  register(profile: AgentProfile): RegistrationResult {
    const idValidation = InputValidator.validateAgentId(profile.id);
    if (!idValidation.valid) {
      AgentRegistry.auditLogger.log({
        principal: "system",
        action: "agent.register",
        resource: profile.id,
        outcome: "denied",
        metadata: { errors: idValidation.errors },
      });
      return { success: false, agentId: profile.id, errors: idValidation.errors };
    }

    if (this.agents.size >= AgentRegistry.MAX_AGENTS) {
      return { success: false, agentId: profile.id, errors: ["Registry capacity exceeded"] };
    }

    if (!AgentRegistry.ALLOWED_ROLES.has(profile.role)) {
      AgentRegistry.auditLogger.log({
        principal: "system",
        action: "agent.register",
        resource: profile.id,
        outcome: "denied",
        metadata: { role: profile.role, reason: "role_not_allowed" },
      });
      return {
        success: false,
        agentId: profile.id,
        errors: [`Role '${profile.role}' is not allowed. Allowed: ${Array.from(AgentRegistry.ALLOWED_ROLES).join(", ")}`],
      };
    }

    if (this.agents.has(profile.id)) {
      return { success: false, agentId: profile.id, errors: ["Agent ID already registered"] };
    }

    this.agents.set(profile.id, profile);

    if (!this.roleIndex.has(profile.role)) {
      this.roleIndex.set(profile.role, new Set());
    }
    this.roleIndex.get(profile.role)!.add(profile.id);

    AgentRegistry.auditLogger.log({
      principal: "system",
      action: "agent.register",
      resource: profile.id,
      outcome: "success",
      metadata: { role: profile.role },
    });

    return { success: true, agentId: profile.id, errors: [] };
  }

  find(role: string): AgentProfile[] {
    if (!AgentRegistry.ALLOWED_ROLES.has(role)) {
      AgentRegistry.auditLogger.log({
        principal: "system",
        action: "agent.find",
        resource: role,
        outcome: "denied",
        metadata: { reason: "role_not_allowed" },
      });
      return [];
    }

    const ids = this.roleIndex.get(role);
    if (!ids) return [];

    return Array.from(ids)
      .map(id => this.agents.get(id))
      .filter((agent): agent is AgentProfile => agent !== undefined);
  }

  get(agentId: string): AgentProfile | undefined {
    const validation = InputValidator.validateAgentId(agentId);
    if (!validation.valid) {
      return undefined;
    }
    return this.agents.get(agentId);
  }

  list(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  unregister(agentId: string): boolean {
    const validation = InputValidator.validateAgentId(agentId);
    if (!validation.valid) {
      return false;
    }

    const profile = this.agents.get(agentId);
    if (!profile) {
      return false;
    }

    this.agents.delete(agentId);

    const roleIds = this.roleIndex.get(profile.role);
    if (roleIds) {
      roleIds.delete(agentId);
      if (roleIds.size === 0) {
        this.roleIndex.delete(profile.role);
      }
    }

    AgentRegistry.auditLogger.log({
      principal: "system",
      action: "agent.unregister",
      resource: agentId,
      outcome: "success",
    });

    return true;
  }

  get size(): number {
    return this.agents.size;
  }
}
