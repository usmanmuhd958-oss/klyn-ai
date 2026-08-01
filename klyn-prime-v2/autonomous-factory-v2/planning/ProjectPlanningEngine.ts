export class ProjectPlanningEngine {


    analyze(requirement:string){

        return {

            goal: requirement,

            phases:[

                "architecture",

                "development",

                "testing",

                "deployment"

            ]

        };

    }


}
