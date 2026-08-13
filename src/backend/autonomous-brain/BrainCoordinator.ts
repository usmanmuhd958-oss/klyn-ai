import {IntelligenceStateManager} from "./IntelligenceStateManager.js";
import {DecisionFusionEngine} from "./DecisionFusionEngine.js";


export class BrainCoordinator {


 state = new IntelligenceStateManager();

 decision = new DecisionFusionEngine();



 process(input:any){

   this.state.update(input);


   return this.decision.decide(
     this.state.get()
   );

 }


}
