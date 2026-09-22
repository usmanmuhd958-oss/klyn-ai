import { AgentEvolutionEngine } from "./AgentEvolutionEngine.js";


export class EvolutionController {

 engine =
  new AgentEvolutionEngine();


 evolveAgent(agent:string){

  return this.engine.evolve(agent);

 }

}
