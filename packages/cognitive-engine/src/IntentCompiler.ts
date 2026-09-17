import { canonicalize, sha256Hex } from "./Canonicalizer.js";
import { IntentValidationError } from "./IntentErrors.js";
import {
  deriveDeterministicIntentId,
  INTENT_SCHEMA_VERSION,
  type AcceptanceCriterion,
  type Assumption,
  type Constraint,
  type Dependency,
  type IntentCompilationResult,
  type IntentContent,
  type IntentSpec,
  type IntentValidationIssue,
  type RequiredEvidence,
  type ResourceBudget,
} from "./IntentSpec.js";

export interface IntentCompilerPolicy {
  readonly maxCpuMillis: number;
  readonly maxMemoryBytes: number;
  readonly maxWallClockMillis: number;
  readonly maxConcurrentTasks: number;
  readonly maxNetworkRequests: number;
  readonly maxArtifactBytes: number;
}

export const DEFAULT_INTENT_COMPILER_POLICY: IntentCompilerPolicy = Object.freeze({
  maxCpuMillis: 86_400_000,
  maxMemoryBytes: 64 * 1024 * 1024 * 1024,
  maxWallClockMillis: 86_400_000,
  maxConcurrentTasks: 1024,
  maxNetworkRequests: 1_000_000,
  maxArtifactBytes: 1024 * 1024 * 1024 * 1024,
});

export class IntentCompiler {
  constructor(private readonly policy: IntentCompilerPolicy = DEFAULT_INTENT_COMPILER_POLICY) {
    validatePositiveIntegerPolicy(this.policy);
  }

  parse(payload: unknown): IntentContent {
    const issues = validatePayload(payload);
    if (issues.length > 0) throw new IntentValidationError(issues);
    return normalizeContent(payload as IntentContent);
  }

  compile(payload: unknown): IntentCompilationResult {
    try {
      const content = this.parse(payload);
      const issues = validateContent(content, this.policy);
      if (issues.length > 0) {
        return Object.freeze({
          accepted: false,
          rejection: Object.freeze({
            schemaVersion: INTENT_SCHEMA_VERSION,
            state: "REJECTED" as const,
            issues: Object.freeze(issues),
          }),
        });
      }

      const canonicalContent = canonicalize(content);
      const contentHash = sha256Hex(canonicalContent);
      const intentId = deriveDeterministicIntentId(contentHash);
      const spec: IntentSpec = {
        ...content,
        schemaVersion: INTENT_SCHEMA_VERSION,
        intentId,
        contentHash,
        canonicalContent,
        state: "FROZEN",
      };
      return Object.freeze({
        accepted: true,
        spec: deepFreeze(spec),
      });
    } catch (error) {
      if (error instanceof IntentValidationError) {
        return Object.freeze({
          accepted: false,
          rejection: Object.freeze({
            schemaVersion: INTENT_SCHEMA_VERSION,
            state: "REJECTED" as const,
            issues: Object.freeze(error.issues),
          }),
        });
      }
      throw error;
    }
  }
}

function validatePositiveIntegerPolicy(policy: IntentCompilerPolicy): void {
  const entries: Array<readonly [string, number]> = [
    ["maxCpuMillis", policy.maxCpuMillis],
    ["maxMemoryBytes", policy.maxMemoryBytes],
    ["maxWallClockMillis", policy.maxWallClockMillis],
    ["maxConcurrentTasks", policy.maxConcurrentTasks],
    ["maxNetworkRequests", policy.maxNetworkRequests],
    ["maxArtifactBytes", policy.maxArtifactBytes],
  ];
  for (const [name, value] of entries) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function validatePayload(payload: unknown): readonly IntentValidationIssue[] {
  const issues: IntentValidationIssue[] = [];
  const root = asRecord(payload);
  if (!root) return [{ path: "$", code: "INVALID_TYPE", message: "Intent payload must be an object" }];

  requireString(root, "specVersion", issues);
  const objective = asRecord(root.objective);
  if (!objective) issues.push({ path: "objective", code: "REQUIRED_OBJECT", message: "objective must be an object" });
  else {
    requireString(objective, "statement", issues, "objective.statement");
    requireString(objective, "outcome", issues, "objective.outcome");
    requireStringArray(objective, "scope", issues, "objective.scope", true);
  }

  validateIdStatementArray(root.constraints, "constraints", issues, ["INVARIANT", "PROHIBITION", "REQUIREMENT"]);
  validateIdStatementArray(root.assumptions, "assumptions", issues);

  const dependencies = root.dependencies;
  if (!Array.isArray(dependencies)) {
    issues.push({ path: "dependencies", code: "REQUIRED_ARRAY", message: "dependencies must be an array" });
  } else {
    for (const [index, item] of dependencies.entries()) {
      const dependency = asRecord(item);
      if (!dependency) {
        issues.push({ path: `dependencies[${index}]`, code: "INVALID_OBJECT", message: "dependency must be an object" });
        continue;
      }
      requireString(dependency, "id", issues, `dependencies[${index}].id`);
      requireEnum(dependency, "kind", ["PACKAGE", "SERVICE", "RESOURCE", "INTENT"], issues, `dependencies[${index}].kind`);
      requireString(dependency, "name", issues, `dependencies[${index}].name`);
      requireBoolean(dependency, "required", issues, `dependencies[${index}].required`);
      requireStringArray(dependency, "dependsOn", issues, `dependencies[${index}].dependsOn`, true);
      if (dependency.version !== undefined) requireString(dependency, "version", issues, `dependencies[${index}].version`);
    }
  }

  validateAcceptanceCriteria(root.acceptanceCriteria, issues);
  validateRequiredEvidence(root.requiredEvidence, issues);

  const riskPolicy = asRecord(root.riskPolicy);
  if (!riskPolicy) issues.push({ path: "riskPolicy", code: "REQUIRED_OBJECT", message: "riskPolicy must be an object" });
  else {
    requireEnum(riskPolicy, "maxRiskLevel", ["LOW", "MEDIUM", "HIGH", "CRITICAL"], issues, "riskPolicy.maxRiskLevel");
    requireStringArray(riskPolicy, "allowedActions", issues, "riskPolicy.allowedActions", true);
    requireBoolean(riskPolicy, "requireHumanApproval", issues, "riskPolicy.requireHumanApproval");
    requireBoolean(riskPolicy, "autoPromotion", issues, "riskPolicy.autoPromotion");
  }

  const resourceBudget = asRecord(root.resourceBudget);
  if (!resourceBudget) issues.push({ path: "resourceBudget", code: "REQUIRED_OBJECT", message: "resourceBudget must be an object" });
  else for (const key of ["maxCpuMillis", "maxMemoryBytes", "maxWallClockMillis", "maxConcurrentTasks", "maxNetworkRequests", "maxArtifactBytes"] as const) requirePositiveSafeInteger(resourceBudget, key, issues, `resourceBudget.${key}`);

  return issues;
}

function validateContent(content: IntentContent, policy: IntentCompilerPolicy): readonly IntentValidationIssue[] {
  const issues: IntentValidationIssue[] = [];
  if (!/^\d+\.\d+\.\d+$/.test(content.specVersion)) issues.push({ path: "specVersion", code: "INVALID_VERSION", message: "specVersion must use MAJOR.MINOR.PATCH form" });
  validateUniqueIds(content.constraints, "constraints", issues);
  validateUniqueIds(content.assumptions, "assumptions", issues);
  validateUniqueIds(content.dependencies, "dependencies", issues);
  validateUniqueIds(content.acceptanceCriteria, "acceptanceCriteria", issues);
  validateUniqueIds(content.requiredEvidence, "requiredEvidence", issues);
  validateDependencyGraph(content.dependencies, issues);
  validateBudget(content.resourceBudget, policy, issues);
  if (content.acceptanceCriteria.length === 0) issues.push({ path: "acceptanceCriteria", code: "EMPTY", message: "At least one acceptance criterion is required" });
  if (content.requiredEvidence.every((item) => !item.required)) issues.push({ path: "requiredEvidence", code: "NO_REQUIRED_EVIDENCE", message: "At least one required evidence item is required" });
  if (content.riskPolicy.autoPromotion && content.riskPolicy.requireHumanApproval) issues.push({ path: "riskPolicy", code: "CONTRADICTORY_POLICY", message: "autoPromotion cannot require human approval simultaneously" });
  return issues;
}

function validateDependencyGraph(dependencies: readonly Dependency[], issues: IntentValidationIssue[]): void {
  const ids = new Set(dependencies.map((dependency) => dependency.id));
  const graph = new Map<string, readonly string[]>();
  for (const dependency of dependencies) {
    const seen = new Set<string>();
    for (const parent of dependency.dependsOn) {
      if (!ids.has(parent)) issues.push({ path: `dependencies.${dependency.id}.dependsOn`, code: "UNKNOWN_DEPENDENCY", message: `Unknown dependency ${parent}` });
      if (parent === dependency.id) issues.push({ path: `dependencies.${dependency.id}.dependsOn`, code: "SELF_DEPENDENCY", message: "Dependency cannot depend on itself" });
      if (seen.has(parent)) issues.push({ path: `dependencies.${dependency.id}.dependsOn`, code: "DUPLICATE_DEPENDENCY", message: `Dependency ${parent} is repeated` });
      seen.add(parent);
    }
    graph.set(dependency.id, dependency.dependsOn);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      issues.push({ path: "dependencies", code: "CYCLIC_DEPENDENCY", message: `Dependency cycle detected: ${[...path.slice(Math.max(0, cycleStart)), id].join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of graph.get(id) ?? []) if (graph.has(parent)) visit(parent, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...graph.keys()].sort()) visit(id, []);
}

function validateBudget(budget: ResourceBudget, policy: IntentCompilerPolicy, issues: IntentValidationIssue[]): void {
  const pairs: Array<readonly [keyof ResourceBudget, keyof IntentCompilerPolicy]> = [
    ["maxCpuMillis", "maxCpuMillis"],
    ["maxMemoryBytes", "maxMemoryBytes"],
    ["maxWallClockMillis", "maxWallClockMillis"],
    ["maxConcurrentTasks", "maxConcurrentTasks"],
    ["maxNetworkRequests", "maxNetworkRequests"],
    ["maxArtifactBytes", "maxArtifactBytes"],
  ];
  for (const [key, policyKey] of pairs) if (budget[key] > policy[policyKey]) issues.push({ path: `resourceBudget.${key}`, code: "BUDGET_EXCEEDED", message: `${key} exceeds compiler policy` });
}

function normalizeContent(input: IntentContent): IntentContent {
  const normalizeStrings = (items: readonly string[]): readonly string[] => Object.freeze([...new Set(items.map((item) => item.trim()))].sort());
  const sortById = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] => Object.freeze(items.map((item) => Object.freeze({ ...item })).sort((a, b) => a.id.localeCompare(b.id)));
  return Object.freeze({
    specVersion: input.specVersion.trim(),
    objective: Object.freeze({
      statement: input.objective.statement.trim(),
      outcome: input.objective.outcome.trim(),
      scope: normalizeStrings(input.objective.scope),
    }),
    constraints: sortById(input.constraints.map((item) => ({ ...item, statement: item.statement.trim() })) as readonly Constraint[]),
    assumptions: sortById(input.assumptions.map((item) => ({ ...item, statement: item.statement.trim() })) as readonly Assumption[]),
    dependencies: sortById(input.dependencies.map((item) => ({ ...item, name: item.name.trim(), version: item.version?.trim(), dependsOn: normalizeStrings(item.dependsOn) })) as readonly Dependency[]),
    acceptanceCriteria: sortById(input.acceptanceCriteria.map((item) => ({ ...item, description: item.description.trim() })) as readonly AcceptanceCriterion[]),
    riskPolicy: Object.freeze({ ...input.riskPolicy, allowedActions: normalizeStrings(input.riskPolicy.allowedActions) }),
    requiredEvidence: sortById(input.requiredEvidence.map((item) => ({ ...item, description: item.description.trim() })) as readonly RequiredEvidence[]),
    resourceBudget: Object.freeze({ ...input.resourceBudget }),
  });
}

function validateUniqueIds(items: readonly { readonly id: string }[], field: string, issues: IntentValidationIssue[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) issues.push({ path: field, code: "DUPLICATE_ID", message: `Duplicate id ${item.id}` });
    seen.add(item.id);
  }
}

function validateIdStatementArray(value: unknown, field: string, issues: IntentValidationIssue[], enumKeys: readonly string[] = []): void {
  if (!Array.isArray(value)) {
    issues.push({ path: field, code: "REQUIRED_ARRAY", message: `${field} must be an array` });
    return;
  }
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    if (!record) { issues.push({ path: `${field}[${index}]`, code: "INVALID_OBJECT", message: "value must be an object" }); continue; }
    requireString(record, "id", issues, `${field}[${index}].id`);
    requireString(record, "statement", issues, `${field}[${index}].statement`);
    if (enumKeys.length > 0) requireEnum(record, "kind", enumKeys, issues, `${field}[${index}].kind`);
  }
}

function validateAcceptanceCriteria(value: unknown, issues: IntentValidationIssue[]): void {
  if (!Array.isArray(value)) { issues.push({ path: "acceptanceCriteria", code: "REQUIRED_ARRAY", message: "acceptanceCriteria must be an array" }); return; }
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    if (!record) { issues.push({ path: `acceptanceCriteria[${index}]`, code: "INVALID_OBJECT", message: "criterion must be an object" }); continue; }
    requireString(record, "id", issues, `acceptanceCriteria[${index}].id`);
    requireString(record, "description", issues, `acceptanceCriteria[${index}].description`);
    requireEnum(record, "verification", ["TEST", "OBSERVATION", "PROOF", "MANUAL_REVIEW"], issues, `acceptanceCriteria[${index}].verification`);
    requireBoolean(record, "required", issues, `acceptanceCriteria[${index}].required`);
  }
}

function validateRequiredEvidence(value: unknown, issues: IntentValidationIssue[]): void {
  if (!Array.isArray(value)) { issues.push({ path: "requiredEvidence", code: "REQUIRED_ARRAY", message: "requiredEvidence must be an array" }); return; }
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    if (!record) { issues.push({ path: `requiredEvidence[${index}]`, code: "INVALID_OBJECT", message: "evidence must be an object" }); continue; }
    requireString(record, "id", issues, `requiredEvidence[${index}].id`);
    requireEnum(record, "kind", ["TEST_RESULT", "BUILD_RESULT", "ARTIFACT_HASH", "OBSERVATION", "PROOF", "REVIEW"], issues, `requiredEvidence[${index}].kind`);
    requireString(record, "description", issues, `requiredEvidence[${index}].description`);
    requireBoolean(record, "required", issues, `requiredEvidence[${index}].required`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requireString(record: Record<string, unknown>, key: string, issues: IntentValidationIssue[], path = key): void {
  if (typeof record[key] !== "string" || record[key].trim() === "") issues.push({ path, code: "REQUIRED_STRING", message: `${key} must be a non-empty string` });
}
function requireStringArray(record: Record<string, unknown>, key: string, issues: IntentValidationIssue[], path = key, allowEmpty = false): void {
  if (!Array.isArray(record[key]) || !record[key].every((item): item is string => typeof item === "string" && (allowEmpty || item.trim() !== ""))) issues.push({ path, code: "INVALID_STRING_ARRAY", message: `${key} must be an array of strings` });
}
function requireBoolean(record: Record<string, unknown>, key: string, issues: IntentValidationIssue[], path = key): void {
  if (typeof record[key] !== "boolean") issues.push({ path, code: "REQUIRED_BOOLEAN", message: `${key} must be boolean` });
}
function requirePositiveSafeInteger(record: Record<string, unknown>, key: string, issues: IntentValidationIssue[], path = key): void {
  if (!Number.isSafeInteger(record[key]) || (record[key] as number) <= 0) issues.push({ path, code: "INVALID_POSITIVE_INTEGER", message: `${key} must be a positive safe integer` });
}
function requireEnum(record: Record<string, unknown>, key: string, values: readonly string[], issues: IntentValidationIssue[], path = key): void {
  if (typeof record[key] !== "string" || !values.includes(record[key])) issues.push({ path, code: "INVALID_ENUM", message: `${key} must be one of ${values.join(", ")}` });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const property of Object.values(value as Record<string, unknown>)) deepFreeze(property);
  return Object.freeze(value);
}