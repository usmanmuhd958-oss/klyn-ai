import { ModelRouter } from "./ModelRouter.js";
import { AIInferenceEngine } from "./AIInferenceEngine.js";


export class ModelOrchestrationEngine {


 router =
  new ModelRouter();


 inference =
  new AIInferenceEngine();



 async run(prompt:string){

  const model =
   this.router.route(prompt);


  return this.inference.execute(
   model.selected,
   prompt
  );

 }


}
