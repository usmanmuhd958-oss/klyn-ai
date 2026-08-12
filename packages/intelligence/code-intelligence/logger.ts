export class IntelligenceLogger {
  constructor(
    private context: string
  ) {}

  debug(message: string, meta?: Record<string, unknown>) {
    console.debug(
      `[DEBUG] [${this.context}]`,
      message,
      meta ?? {}
    );
  }

  info(message: string, meta?: Record<string, unknown>) {
    console.info(
      `[INFO] [${this.context}]`,
      message,
      meta ?? {}
    );
  }

  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(
      `[WARN] [${this.context}]`,
      message,
      meta ?? {}
    );
  }

  error(message: string, meta?: Record<string, unknown>) {
    console.error(
      `[ERROR] [${this.context}]`,
      message,
      meta ?? {}
    );
  }
}
