export class StrategicPlanner {


    createPlan(goal:string){

        return [

            {
                step:1,
                action:"analyze"
            },

            {
                step:2,
                action:"execute"
            },

            {
                step:3,
                action:"verify"
            }

        ];

    }


}
