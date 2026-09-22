export class PlanExecutor {


 async execute(plan:any[]){

  return {

   executed:true,

   steps:plan.length

  };

 }


}
