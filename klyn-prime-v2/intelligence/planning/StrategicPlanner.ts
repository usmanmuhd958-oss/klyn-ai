export interface PlanStep {

  step:number;

  action:string;

  objective:string;

}


export class StrategicPlanner {


 createPlan(goal:string):PlanStep[] {


   return [

     {
       step:1,
       action:"analyze",
       objective:goal
     },

     {
       step:2,
       action:"execute",
       objective:"perform solution"
     },

     {
       step:3,
       action:"verify",
       objective:"measure result"
     }

   ];


 }


}
