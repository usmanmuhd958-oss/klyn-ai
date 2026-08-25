import type { IntentSpecification } from "./IntentParser";

export class SpecRefiner {
  refine(spec: IntentSpecification) {
    return {
      ...spec,
      verified: true,
      questions: [
        "Who are the primary users?",
        "What security boundaries exist?"
      ]
    };
  }
}
