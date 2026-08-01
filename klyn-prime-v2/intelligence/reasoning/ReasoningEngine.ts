export class ReasoningEngine {


 async analyze(input:string){

   return {

     understanding:
       `Analyzing: ${input}`,

     possibleActions:[

       "plan",

       "execute",

       "verify"

     ]

   };

 }


}
