import { IntentTransitionError } from "./IntentErrors.js";
import type { IntentSpec, IntentState } from "./IntentSpec.js";

const TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> = {
  DRAFT: ["VALIDATING", "REJECTED"],
  VALIDATING: ["VALIDATED", "REJECTED"],
  VALIDATED: ["FROZEN", "REJECTED"],
  FROZEN: ["EXECUTABLE"],
  EXECUTABLE: [],
  REJECTED: ["DRAFT"],
};

export class IntentStateMachine {
  canTransition(from: IntentState, to: IntentState): boolean {
    return TRANSITIONS[from].includes(to);
  }

  transition(spec: IntentSpec, to: IntentState): IntentSpec {
    if (!this.canTransition(spec.state, to)) {
      throw new IntentTransitionError(spec.state, to);
    }
    const next = { ...spec, state: to };
    return Object.freeze(next);
  }

  reject(spec: IntentSpec): IntentSpec {
    return this.transition(spec, "REJECTED");
  }
}
