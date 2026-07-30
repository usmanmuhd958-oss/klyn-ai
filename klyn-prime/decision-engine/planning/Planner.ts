export interface Plan {

    goal:string;

    steps:string[];

}


export class Planner {


    create(goal:string):Plan {

        return {

            goal,

            steps:[

                "analyze",

                "execute",

                "verify"

            ]

        };

    }

}
