export interface Goal {

    id:string;

    description:string;

    priority:number;

    status:
    | "created"
    | "planning"
    | "executing"
    | "completed"
    | "failed";

}


export class GoalEngine {


    private goals =
        new Map<string, Goal>();


    create(goal:Goal){

        this.goals.set(
            goal.id,
            goal
        );

    }


    updateStatus(
        id:string,
        status:Goal["status"]
    ){

        const goal =
            this.goals.get(id);


        if(goal){

            goal.status = status;

        }

    }


    get(id:string){

        return this.goals.get(id);

    }


    list(){

        return [
            ...this.goals.values()
        ];

    }

}
