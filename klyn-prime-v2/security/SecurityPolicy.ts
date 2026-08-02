export interface SecurityPolicy {
  maxTaskLength: number;
  maxAgentsPerPrincipal: number;
  allowedPaths: string[];
  forbiddenPatterns: RegExp[];
  requireCapabilityCheck: boolean;
  auditEnabled: boolean;
  maxConcurrentTasks: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxTaskLength: 65536,
  maxAgentsPerPrincipal: 50,
  allowedPaths: ['/tmp/genesis', process.cwd()],
  forbiddenPatterns: [
    /(?:rm\s+(-rf?|--recursive)\s+(\/|\$HOME|\~))/i,
    /(?:curl\s+.*\|\s*(?:sh|bash|zsh|fish))/i,
    /(?:wget\s+.*\|\s*(?:sh|bash|zsh|fish))/i,
    /(?:eval\s+["']?\s*(?:\$|`|\$\())/i,
    /(?:exec\s+["']?\s*(?:\$|`|\$\())/i,
    /(?:sudo\s+.*(?:\||;|\&\&|\|\|))/i,
    /(?:chmod\s+.*\s+777)/i,
    /(?:chown\s+.*\s+root)/i,
    /(?:mkfs\s+|dd\s+.*\s+of=\/)/i,
    /\.\.(\/|\\\\)/g,
    /\$\{.*\}/g,
    /`/g,
  ],
  requireCapabilityCheck: true,
  auditEnabled: true,
  maxConcurrentTasks: 100,
};
