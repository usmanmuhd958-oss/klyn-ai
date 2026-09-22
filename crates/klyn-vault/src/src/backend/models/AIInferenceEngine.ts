export class AIInferenceEngine {


 async execute(
  model:string,
  prompt:string
 ){

  return {

   model,

   output:prompt

  };


 }


}
