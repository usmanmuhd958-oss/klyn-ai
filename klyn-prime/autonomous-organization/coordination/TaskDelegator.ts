export interface Task {

    name:string;

    agent:string;

}


export class TaskDelegator {


    delegate(task:Task){

        return {

            assignedTo:
            task.agent,

            task:
            task.name,

            status:"assigned"

        };

    }

}
