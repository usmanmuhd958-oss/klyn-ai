
export type PlanStep = {
    id:string;
    action:string;
};


export class Planner {


    createPlan(goal:string):PlanStep[]{

        return [
            {
                id:"analysis",
                action:`Analyze ${goal}`
            },
            {
                id:"execution",
                action:"Execute solution"
            },
            {
                id:"verification",
                action:"Verify result"
            }
        ];

    }

}

