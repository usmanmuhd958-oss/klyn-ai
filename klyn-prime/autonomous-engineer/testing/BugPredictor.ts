export interface BugPrediction {
  risk: string;
  probability: number;
}


export class BugPredictor {

  predict(code: string): BugPrediction {

    return {
      risk: "low",
      probability: 0.01
    };

  }

}
