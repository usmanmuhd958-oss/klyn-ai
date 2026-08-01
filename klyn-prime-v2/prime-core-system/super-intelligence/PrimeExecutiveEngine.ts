export class PrimeExecutiveEngine {


    constructor(
        private mission:any,
        private planning:any,
        private execution:any,
        private evaluation:any,
        private learning:any
    ){}



    async run(objective:string){


        const mission =
        this.mission.create(
            objective,
            1
        );


        const plan =
        this.planning.createPlan(
            mission
        );


        const result =
        await this.execution.execute(
            plan
        );


        const score =
        this.evaluation.evaluate(
            result
        );


        this.learning.learn({

            mission,

            result,

            score

        });


        return {

            mission,

            result,

            score,

            status:
            "completed"

        };


    }


}
