export class DecisionEngine {


 async choose(analysis:any){

   return {

     selected:
       analysis.possibleActions[0],

     confidence:0.5

   };

 }


}
