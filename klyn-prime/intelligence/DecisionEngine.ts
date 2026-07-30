export interface Decision {
  action: string;
  confidence: number;
}


export class DecisionEngine {


  async decide(options: string[]): Promise<Decision> {


    return {

      action: options[0],

      confidence: 0.5

    };

  }


}
