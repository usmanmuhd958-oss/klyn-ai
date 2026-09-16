import { Intent } from "../contracts";

export class IntentEngine {

  async analyze(
    input: string,
    context: Record<string, unknown> = {}
  ): Promise<Intent> {

    return {
      id: crypto.randomUUID(),
      goal: input,
      priority: this.calculatePriority(input),
      context
    };
  }


  private calculatePriority(input: string): number {
    const urgentWords = [
      "critical",
      "urgent",
      "security",
      "production",
      "error"
    ];

    return urgentWords.some(word =>
      input.toLowerCase().includes(word)
    )
      ? 10
      : 5;
  }
}
