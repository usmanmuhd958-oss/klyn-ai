export class AutonomousExecutor {

 async execute(plan:any){

   return {
    success:true,
    executed:plan.steps
   };

 }

}
