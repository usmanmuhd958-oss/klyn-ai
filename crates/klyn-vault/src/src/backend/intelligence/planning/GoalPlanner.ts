export interface Goal {

 id:string;

 description:string;

}


export class GoalPlanner {


 createGoal(description:string):Goal{

  return {

   id:crypto.randomUUID(),

   description

  };

 }


}
