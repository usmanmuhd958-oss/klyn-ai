import type { ContextItem, ContextSelectionPolicy, ContextSelectionResult } from "./types.js";

const DEFAULT_POLICY: ContextSelectionPolicy = {
  maxTokens: 16_000,
  reserveTokens: 2_000,
  maxItems: 64,
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function priorityWeight(item: ContextItem): number {
  switch (item.priority) {
    case "required": return 4;
    case "high": return 3;
    case "normal": return 2;
    case "low": return 1;
  }
}

export class ContextSelector {
  private readonly policy: ContextSelectionPolicy;

  constructor(policy: Partial<ContextSelectionPolicy> = {}) {
    this.policy = {
      maxTokens: policy.maxTokens ?? DEFAULT_POLICY.maxTokens,
      reserveTokens: policy.reserveTokens ?? DEFAULT_POLICY.reserveTokens,
      maxItems: policy.maxItems ?? DEFAULT_POLICY.maxItems,
    };
    if (!Number.isInteger(this.policy.maxTokens) || this.policy.maxTokens <= 0) throw new Error("maxTokens must be a positive integer");
    if (!Number.isInteger(this.policy.reserveTokens) || this.policy.reserveTokens < 0) throw new Error("reserveTokens must be a non-negative integer");
    if (!Number.isInteger(this.policy.maxItems) || this.policy.maxItems <= 0) throw new Error("maxItems must be a positive integer");
    if (this.policy.reserveTokens >= this.policy.maxTokens) throw new Error("reserveTokens must be smaller than maxTokens");
  }

  select(items: readonly ContextItem[], policyOverride: Partial<ContextSelectionPolicy> = {}): ContextSelectionResult {
    const policy: ContextSelectionPolicy = {
      maxTokens: policyOverride.maxTokens ?? this.policy.maxTokens,
      reserveTokens: policyOverride.reserveTokens ?? this.policy.reserveTokens,
      maxItems: policyOverride.maxItems ?? this.policy.maxItems,
    };
    if (policy.reserveTokens >= policy.maxTokens) throw new Error("reserveTokens must be smaller than maxTokens");

    const unique = new Map<string, ContextItem>();
    for (const item of items) {
      if (!item.id.trim() || !item.content.trim()) throw new Error("context item id and content are required");
      if (!Number.isFinite(item.score)) throw new Error(`context score must be finite: ${item.id}`);
      if (unique.has(item.id)) throw new Error(`duplicate context item id: ${item.id}`);
      unique.set(item.id, Object.freeze({ ...item }));
    }

    const candidates = [...unique.values()].sort((a, b) => {
      const requiredDelta = Number(Boolean(b.required || b.priority === "required")) - Number(Boolean(a.required || a.priority === "required"));
      if (requiredDelta !== 0) return requiredDelta;
      const priorityDelta = priorityWeight(b) - priorityWeight(a);
      if (priorityDelta !== 0) return priorityDelta;
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return a.id.localeCompare(b.id);
    });

    const selected: ContextItem[] = [];
    const omitted: ContextItem[] = [];
    const budget = policy.maxTokens - policy.reserveTokens;
    let used = 0;

    for (const item of candidates) {
      const tokens = item.tokenEstimate ?? estimateTokens(item.content);
      if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new Error(`invalid token estimate: ${item.id}`);
      const required = Boolean(item.required || item.priority === "required");
      if (selected.length >= policy.maxItems || used + tokens > budget) {
        if (required) throw new Error(`required context item exceeds available context budget: ${item.id}`);
        omitted.push(item);
        continue;
      }
      selected.push(item);
      used += tokens;
    }

    selected.sort((a, b) => candidates.indexOf(a) - candidates.indexOf(b));
    omitted.sort((a, b) => a.id.localeCompare(b.id));
    return Object.freeze({ selected, omitted, estimatedTokens: used });
  }
}
