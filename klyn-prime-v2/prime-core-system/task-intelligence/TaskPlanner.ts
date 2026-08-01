export class TaskPlanner {


    createPlan(
        analysis:any
    ){

        return {

            task:
            analysis.task,

            steps:[],

            status:
            "planned"

        };

    }


}
