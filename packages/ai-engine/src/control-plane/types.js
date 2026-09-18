export class AiEngineError extends Error {
    code;
    providerId;
    retryable;
    status;
    constructor(code, message, options = {}) {
        super(message, { cause: options.cause });
        this.code = code;
        this.name = "AiEngineError";
        this.providerId = options.providerId;
        this.retryable = options.retryable ?? false;
        this.status = options.status;
    }
}
//# sourceMappingURL=types.js.map