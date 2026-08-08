export class DecisionOrchestrator {

 decide(input:any){

   return {
     decision:"generated",
     input,
     confidence:0.95
   };

 }

}
