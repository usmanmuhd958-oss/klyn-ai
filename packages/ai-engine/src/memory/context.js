export class EphemeralContext {
    maxMessages;
    maxChars;
    messages = [];
    constructor(maxMessages = 64, maxChars = 120_000) {
        this.maxMessages = maxMessages;
        this.maxChars = maxChars;
    }
    append(message) {
        if (message.content.length > this.maxChars)
            throw new Error("Context message exceeds maximum size");
        this.messages.push({ ...message });
        while (this.messages.length > this.maxMessages || this.totalChars() > this.maxChars)
            this.messages.shift();
    }
    snapshot() { return this.messages.map(message => ({ ...message })); }
    clear() { this.messages = []; }
    totalChars() { return this.messages.reduce((sum, message) => sum + message.content.length, 0); }
}
//# sourceMappingURL=context.js.map