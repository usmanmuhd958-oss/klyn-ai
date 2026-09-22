export class CodePlanningEngine {


  createPlan(request:any){

    return {

      request,

      steps:[
        "analyze-code",
        "modify",
        "validate"
      ]

    };

  }


}
