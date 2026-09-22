import {DecisionBridge} from "./DecisionBridge.js";


export class ReasoningLoop {

  decision = new DecisionBridge();


  reason(input:any){

    const decision =
      this.decision.decide(input);


    return {

      reasoning:true,

      decision

    };

  }

}
