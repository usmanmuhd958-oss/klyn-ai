export class EngineeringPlanner {

 plan(goal:string){

  return {
   goal,
   steps:[
    "analyze",
    "implement",
    "test",
    "review"
   ]
  };

 }

}
