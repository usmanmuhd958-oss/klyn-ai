const estimate = (text) => Math.max(1, Math.ceil(text.length / 4));
export class ContextBudgetManager {
    budget;
    compactAtRatio;
    constructor(budget) {
        this.budget = budget;
        if (!Number.isFinite(budget.maxTokens) || budget.maxTokens <= 0)
            throw new Error("maxTokens must be positive");
        this.compactAtRatio = Math.min(1, Math.max(0.5, budget.compactAtRatio ?? 0.8));
    }
    estimateMessage(message) { return message.tokenEstimate ?? estimate(message.content); }
    estimate(messages) { return messages.reduce((sum, message) => sum + this.estimateMessage(message), 0); }
    shouldCompact(messages) { return this.estimate(messages) >= Math.floor(this.budget.maxTokens * this.compactAtRatio); }
    available(messages) { return Math.max(0, this.budget.maxTokens - this.estimate(messages) - this.budget.reserveTokens); }
}
/** Deterministic local compactor. It preserves recent turns and converts older context into structured notes. */
export class ContextCompactor {
    keepRecent;
    constructor(keepRecent = 8) {
        this.keepRecent = keepRecent;
        if (keepRecent < 1)
            throw new Error("keepRecent must be positive");
    }
    compact(messages, notes) {
        const older = messages.slice(0, Math.max(0, messages.length - this.keepRecent));
        const noteLines = notes.map((note) => `[${note.kind}] ${note.content}`);
        const messageLines = older.map((message) => `[${message.role}] ${message.content}`);
        const content = ["EXECUTION COMPACTION", "", "Structured notes:", ...noteLines, "", "Prior context:", ...messageLines].join("\n").trim();
        return { role: "summary", content, tokenEstimate: estimate(content), metadata: { compactedMessages: older.length, noteCount: notes.length } };
    }
}
export class ContextControlPlane {
    budget;
    compactor;
    notes = [];
    constructor(budget, compactor = new ContextCompactor()) {
        this.budget = budget;
        this.compactor = compactor;
    }
    addNote(note) { this.notes.push({ ...note, createdAt: Date.now() }); }
    getNotes() { return [...this.notes]; }
    snapshot(messages) {
        if (!this.budget.shouldCompact(messages))
            return { messages: [...messages], notes: this.getNotes(), estimatedTokens: this.budget.estimate(messages), compacted: false };
        const summary = this.compactor.compact(messages, this.notes);
        const retained = messages.slice(-8);
        const next = [summary, ...retained];
        return { messages: next, notes: this.getNotes(), estimatedTokens: this.budget.estimate(next), compacted: true };
    }
}
export function distillSubagentResult(result) {
    const notes = [{ id: `${result.taskId}:outcome`, kind: result.outcome === "succeeded" ? "progress" : "unresolved", content: result.summary, createdAt: Date.now() }];
    for (const artifact of result.artifacts ?? [])
        notes.push({ id: `${result.taskId}:artifact:${artifact}`, kind: "artifact", content: artifact, createdAt: Date.now() });
    for (const unresolved of result.unresolved ?? [])
        notes.push({ id: `${result.taskId}:unresolved:${unresolved}`, kind: "unresolved", content: unresolved, createdAt: Date.now() });
    return notes;
}
//# sourceMappingURL=context-control-plane.js.map