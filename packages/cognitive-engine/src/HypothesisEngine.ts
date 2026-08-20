export interface Hypothesis {

  id: string;

  statement: string;

  confidence: number;

  evidence: string[];

  createdAt: Date;
}


export class HypothesisEngine {

  private hypotheses: Hypothesis[] = [];


  create(
    statement: string,
    evidence: string[] = []
  ): Hypothesis {

    const hypothesis: Hypothesis = {

      id: crypto.randomUUID(),

      statement,

      confidence: 0.5,

      evidence,

      createdAt: new Date()
    };


    this.hypotheses.push(hypothesis);

    return hypothesis;
  }


  evaluate(
    id: string,
    confidence: number
  ): void {

    const hypothesis =
      this.hypotheses.find(
        item => item.id === id
      );


    if (hypothesis) {

      hypothesis.confidence =
        confidence;
    }
  }


  getHypotheses(): Hypothesis[] {

    return this.hypotheses;
  }


  getBestHypothesis(): Hypothesis | undefined {

    return this.hypotheses
      .sort(
        (a,b) =>
          b.confidence -
          a.confidence
      )[0];
  }
}
