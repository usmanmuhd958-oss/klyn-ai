import { LearningLoop } from "./LearningLoop.js";
import { EvolutionStrategy } from "./EvolutionStrategy.js";


export class AgentEvolutionEngine {

 learning =
  new LearningLoop();

 strategy =
  new EvolutionStrategy();


 evolve(agent:string){

  return {

   agent,

   learning:this.learning.run(),

   strategy:this.strategy.select(),

   evolved:true

  };

 }

}
