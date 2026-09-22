export class TaskDecomposer {


 decompose(goal:any){

  return [

   {
    id:"task-1",
    goal:goal.description
   }

  ];

 }


}
