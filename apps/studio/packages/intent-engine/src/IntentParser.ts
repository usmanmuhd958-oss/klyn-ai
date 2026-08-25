export interface IntentSpecification {
  goal: string;
  requirements: string[];
  confidence: number;
}

export class IntentParser {
  parse(input: string): IntentSpecification {
    return {
      goal: input,
      requirements: input
        .split(".")
        .map(item => item.trim())
        .filter(Boolean),
      confidence: 0.92
    };
  }
}
