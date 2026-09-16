export class GoalPlanner {

  plan(goal:any){

    return {
      goal,
      steps:[
        "analyze",
        "execute",
        "evaluate"
      ]
    };

  }

}
