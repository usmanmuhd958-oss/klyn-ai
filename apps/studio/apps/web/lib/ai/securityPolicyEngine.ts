export type SecurityAction =
  | "read_code"
  | "write_code"
  | "create_artifact"
  | "modify_database"
  | "deploy"
  | "manage_infrastructure";

export interface SecurityContext {
  userId: string;
  workspaceId: string;
  agentId: string;
  action: SecurityAction;
  resource?: string;
}

export interface SecurityDecision {
  allowed: boolean;
  reason: string;
}

const restrictedActions: SecurityAction[] = [
  "deploy",
  "manage_infrastructure",
  "modify_database",
];

class SecurityPolicyEngine {
  evaluate(context: SecurityContext): SecurityDecision {
    try {
      if (!context.userId || !context.workspaceId) {
        return {
          allowed: false,
          reason: "Missing security identity",
        };
      }

      if (restrictedActions.includes(context.action)) {
        if (!context.agentId.includes("operator")) {
          return {
            allowed: false,
            reason: "Agent does not have elevated permission",
          };
        }
      }

      return {
        allowed: true,
        reason: "Policy validation passed",
      };
    } catch (error) {
      return {
        allowed: false,
        reason:
          error instanceof Error
            ? error.message
            : "Security validation failed",
      };
    }
  }

  assertAllowed(context: SecurityContext) {
    const result = this.evaluate(context);

    if (!result.allowed) {
      throw new Error(`Security blocked: ${result.reason}`);
    }

    return true;
  }
}

export const securityPolicyEngine = new SecurityPolicyEngine();
