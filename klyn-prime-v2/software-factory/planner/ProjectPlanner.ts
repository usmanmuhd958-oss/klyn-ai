export interface ProjectPlan {

    goal:string;

    requirements:string[];

    phases:string[];

}


export class ProjectPlanner {


    createPlan(goal:string):ProjectPlan {

        return {

            goal,

            requirements:[],

            phases:[

                "architecture",

                "development",

                "testing",

                "deployment"

            ]

        };

    }


}
