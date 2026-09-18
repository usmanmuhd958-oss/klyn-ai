export interface ContextMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    metadata?: Record<string, string>;
}
export declare class EphemeralContext {
    private readonly maxMessages;
    private readonly maxChars;
    private messages;
    constructor(maxMessages?: number, maxChars?: number);
    append(message: ContextMessage): void;
    snapshot(): ContextMessage[];
    clear(): void;
    private totalChars;
}
//# sourceMappingURL=context.d.ts.map