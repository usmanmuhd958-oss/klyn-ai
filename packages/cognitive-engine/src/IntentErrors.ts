export class IntentSpecError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class IntentValidationError extends IntentSpecError {
  constructor(public readonly issues: readonly { readonly path: string; readonly code: string; readonly message: string }[]) {
    super(issues.map((issue) => `${issue.path || "$"}: ${issue.message}`).join("; "));
  }
}

export class IntentTransitionError extends IntentSpecError {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Invalid IntentSpec transition: ${from} -> ${to}`);
  }
}

export class IntentMutationError extends IntentSpecError {
  constructor() {
    super("IntentSpec is immutable after compilation");
  }
}
