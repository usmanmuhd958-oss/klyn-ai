import {LearningEngine} from "./LearningEngine.js";


export class EvolutionController {


 engine=new LearningEngine();



 evolve(input:any){

   return this.engine.learn(input);

 }


}
