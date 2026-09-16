import {
  EvaluationRecord,
  IntelligenceScore
} from "./types.js";


export class EvaluationEngine {

  private records:
    EvaluationRecord[];


  constructor() {

    this.records = [];

  }


  evaluate(
    record: EvaluationRecord
  ): void {

    this.records.push(record);

  }


  score(): IntelligenceScore {

    if (this.records.length === 0) {

      return {
        overall: 0,
        confidence: 0,
        samples: 0
      };

    }


    const total =
      this.records.reduce(
        (sum,item)=>
          sum + item.score,
        0
      );


    const confidence =
      this.records.reduce(
        (sum,item)=>
          sum + item.confidence,
        0
      );


    return {

      overall:
        total / this.records.length,

      confidence:
        confidence / this.records.length,

      samples:
        this.records.length

    };

  }


  snapshot(){

    return this.records;

  }

}
