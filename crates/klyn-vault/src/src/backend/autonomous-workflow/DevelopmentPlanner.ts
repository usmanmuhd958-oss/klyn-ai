export class DevelopmentPlanner {

  createPlan(goal:string){

    return {

      goal,

      steps:[

        "analyze-requirements",

        "design-solution",

        "implement",

        "test",

        "validate"

      ]

    };

  }

}
