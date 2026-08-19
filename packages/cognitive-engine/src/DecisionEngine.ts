export interface DecisionContext {
  objective: string;

  options: string[];

  confidenceThreshold?: number;
}


export interface DecisionResult {
  selectedAction: string;

  confidence: number;

  rejectedOptions: string[];

  reasoning: string;
}


export class DecisionEngine {


  decide(
    context: DecisionContext
  ): DecisionResult {


    const selected =
      context.options[0] ??
      "No action";


    return {

      selectedAction: selected,

      confidence: 0.5,

      rejectedOptions:
        context.options.slice(1),

      reasoning:
        `Selected action based on objective: ${context.objective}`

    };

  }

}
