export class Planner {


  async createPlan(goal: string) {


    return {

      goal,

      steps: [

        "analyze",

        "design",

        "execute",

        "verify"

      ]

    };


  }


}
