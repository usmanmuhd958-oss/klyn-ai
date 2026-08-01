export interface PlanTask {

    id:string;

    title:string;

    priority:number;

    status:
    | "pending"
    | "running"
    | "completed"
    | "failed";

}


export interface Plan {

    goalId:string;

    tasks:PlanTask[];

}



export class PlanningEngine {


    createPlan(
        goalId:string,
        objectives:string[]
    ):Plan{


        const tasks =
            objectives.map(
                (item,index)=>({

                    id:`task-${index+1}`,

                    title:item,

                    priority:index+1,

                    status:"pending"

                })
            );


        return {

            goalId,

            tasks

        };

    }


    nextTask(plan:Plan){

        return plan.tasks.find(
            task =>
            task.status==="pending"
        );

    }

}
