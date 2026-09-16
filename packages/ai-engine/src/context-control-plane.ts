export type ContextRole = "system" | "user" | "assistant" | "tool" | "summary";
export interface ContextMessage { readonly role: ContextRole; readonly content: string; readonly tokenEstimate?: number; readonly metadata?: Readonly<Record<string, unknown>>; }
export interface ExecutionNote { readonly id: string; readonly kind: "decision" | "progress" | "constraint" | "unresolved" | "artifact"; readonly content: string; readonly createdAt: number; }
export interface ContextBudget { readonly maxTokens: number; readonly reserveTokens: number; readonly compactAtRatio?: number; }
export interface ContextSnapshot { readonly messages: readonly ContextMessage[]; readonly notes: readonly ExecutionNote[]; readonly estimatedTokens: number; readonly compacted: boolean; }

const estimate = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

export class ContextBudgetManager {
  private readonly compactAtRatio: number;
  constructor(private readonly budget: ContextBudget) {
    if (!Number.isFinite(budget.maxTokens) || budget.maxTokens <= 0) throw new Error("maxTokens must be positive");
    this.compactAtRatio = Math.min(1, Math.max(0.5, budget.compactAtRatio ?? 0.8));
  }
  estimateMessage(message: ContextMessage): number { return message.tokenEstimate ?? estimate(message.content); }
  estimate(messages: readonly ContextMessage[]): number { return messages.reduce((sum, message) => sum + this.estimateMessage(message), 0); }
  shouldCompact(messages: readonly ContextMessage[]): boolean { return this.estimate(messages) >= Math.floor(this.budget.maxTokens * this.compactAtRatio); }
  available(messages: readonly ContextMessage[]): number { return Math.max(0, this.budget.maxTokens - this.estimate(messages) - this.budget.reserveTokens); }
}

export interface Compactor { compact(messages: readonly ContextMessage[], notes: readonly ExecutionNote[]): ContextMessage; }

/** Deterministic local compactor. It preserves recent turns and converts older context into structured notes. */
export class ContextCompactor implements Compactor {
  constructor(private readonly keepRecent = 8) { if (keepRecent < 1) throw new Error("keepRecent must be positive"); }
  compact(messages: readonly ContextMessage[], notes: readonly ExecutionNote[]): ContextMessage {
    const older = messages.slice(0, Math.max(0, messages.length - this.keepRecent));
    const noteLines = notes.map((note) => `[${note.kind}] ${note.content}`);
    const messageLines = older.map((message) => `[${message.role}] ${message.content}`);
    const content = ["EXECUTION COMPACTION", "", "Structured notes:", ...noteLines, "", "Prior context:", ...messageLines].join("\n").trim();
    return { role: "summary", content, tokenEstimate: estimate(content), metadata: { compactedMessages: older.length, noteCount: notes.length } };
  }
}

export class ContextControlPlane {
  private readonly notes: ExecutionNote[] = [];
  constructor(private readonly budget: ContextBudgetManager, private readonly compactor: Compactor = new ContextCompactor()) {}
  addNote(note: Omit<ExecutionNote, "createdAt">): void { this.notes.push({ ...note, createdAt: Date.now() }); }
  getNotes(): readonly ExecutionNote[] { return [...this.notes]; }
  snapshot(messages: readonly ContextMessage[]): ContextSnapshot {
    if (!this.budget.shouldCompact(messages)) return { messages: [...messages], notes: this.getNotes(), estimatedTokens: this.budget.estimate(messages), compacted: false };
    const summary = this.compactor.compact(messages, this.notes);
    const retained = messages.slice(-8);
    const next = [summary, ...retained];
    return { messages: next, notes: this.getNotes(), estimatedTokens: this.budget.estimate(next), compacted: true };
  }
}

export interface SubagentResult { readonly taskId: string; readonly outcome: "succeeded" | "failed"; readonly summary: string; readonly artifacts?: readonly string[]; readonly unresolved?: readonly string[]; }
export function distillSubagentResult(result: SubagentResult): ExecutionNote[] {
  const notes: ExecutionNote[] = [{ id: `${result.taskId}:outcome`, kind: result.outcome === "succeeded" ? "progress" : "unresolved", content: result.summary, createdAt: Date.now() }];
  for (const artifact of result.artifacts ?? []) notes.push({ id: `${result.taskId}:artifact:${artifact}`, kind: "artifact", content: artifact, createdAt: Date.now() });
  for (const unresolved of result.unresolved ?? []) notes.push({ id: `${result.taskId}:unresolved:${unresolved}`, kind: "unresolved", content: unresolved, createdAt: Date.now() });
  return notes;
}
