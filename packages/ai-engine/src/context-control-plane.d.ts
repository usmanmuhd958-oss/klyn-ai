export type ContextRole = "system" | "user" | "assistant" | "tool" | "summary";
export interface ContextMessage {
    readonly role: ContextRole;
    readonly content: string;
    readonly tokenEstimate?: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface ExecutionNote {
    readonly id: string;
    readonly kind: "decision" | "progress" | "constraint" | "unresolved" | "artifact";
    readonly content: string;
    readonly createdAt: number;
}
export interface ContextBudget {
    readonly maxTokens: number;
    readonly reserveTokens: number;
    readonly compactAtRatio?: number;
}
export interface ContextSnapshot {
    readonly messages: readonly ContextMessage[];
    readonly notes: readonly ExecutionNote[];
    readonly estimatedTokens: number;
    readonly compacted: boolean;
}
export declare class ContextBudgetManager {
    private readonly budget;
    private readonly compactAtRatio;
    constructor(budget: ContextBudget);
    estimateMessage(message: ContextMessage): number;
    estimate(messages: readonly ContextMessage[]): number;
    shouldCompact(messages: readonly ContextMessage[]): boolean;
    available(messages: readonly ContextMessage[]): number;
}
export interface Compactor {
    compact(messages: readonly ContextMessage[], notes: readonly ExecutionNote[]): ContextMessage;
}
/** Deterministic local compactor. It preserves recent turns and converts older context into structured notes. */
export declare class ContextCompactor implements Compactor {
    private readonly keepRecent;
    constructor(keepRecent?: number);
    compact(messages: readonly ContextMessage[], notes: readonly ExecutionNote[]): ContextMessage;
}
export declare class ContextControlPlane {
    private readonly budget;
    private readonly compactor;
    private readonly notes;
    constructor(budget: ContextBudgetManager, compactor?: Compactor);
    addNote(note: Omit<ExecutionNote, "createdAt">): void;
    getNotes(): readonly ExecutionNote[];
    snapshot(messages: readonly ContextMessage[]): ContextSnapshot;
}
export interface SubagentResult {
    readonly taskId: string;
    readonly outcome: "succeeded" | "failed";
    readonly summary: string;
    readonly artifacts?: readonly string[];
    readonly unresolved?: readonly string[];
}
export declare function distillSubagentResult(result: SubagentResult): ExecutionNote[];
//# sourceMappingURL=context-control-plane.d.ts.map