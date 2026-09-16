export class EngineeringExecutor {

 execute(plan:any){

   return {
     executed:true,
     strategy:plan.strategy,
     status:"completed"
   };

 }

}
