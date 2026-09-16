export interface ContextMessage { role: "system" | "user" | "assistant" | "tool"; content: string; metadata?: Record<string, string>; }

export class EphemeralContext {
  private messages: ContextMessage[] = [];
  constructor(private readonly maxMessages = 64, private readonly maxChars = 120_000) {}

  append(message: ContextMessage): void {
    if (message.content.length > this.maxChars) throw new Error("Context message exceeds maximum size");
    this.messages.push({ ...message });
    while (this.messages.length > this.maxMessages || this.totalChars() > this.maxChars) this.messages.shift();
  }

  snapshot(): ContextMessage[] { return this.messages.map(message => ({ ...message })); }
  clear(): void { this.messages = []; }
  private totalChars(): number { return this.messages.reduce((sum, message) => sum + message.content.length, 0); }
}
