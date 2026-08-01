import { ReasoningEngine } from "../reasoning/ReasoningEngine";
import { DecisionEngine } from "../decision/DecisionEngine";


export class PrimeBrain {

  private reasoning: ReasoningEngine;
  private decision: DecisionEngine;


  constructor(){

    this.reasoning = new ReasoningEngine();

    this.decision = new DecisionEngine();

  }


  async think(problem:string){

    const analysis =
      await this.reasoning.analyze(problem);


    const decision =
      await this.decision.choose(analysis);


    return {

      problem,

      analysis,

      decision

    };

  }

}
