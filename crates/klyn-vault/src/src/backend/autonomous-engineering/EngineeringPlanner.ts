export class EngineeringPlanner {

  plan(task:any){

    return {
      task,
      steps:[
        "analyze",
        "implement",
        "test",
        "review"
      ]
    };

  }

}
