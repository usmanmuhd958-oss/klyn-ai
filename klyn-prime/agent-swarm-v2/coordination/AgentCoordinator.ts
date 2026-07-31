/**
 * KLYN Prime Agent Coordination Engine
 *
 * Autonomous task planning and agent orchestration.
 */


export interface CoordinationTask {

    id:string;

    objective:string;

    priority:
        | "low"
        | "medium"
        | "high"
        | "critical";

    assignedAgent?:string;

    status:
        | "pending"
        | "running"
        | "completed"
        | "failed";

}




export interface AvailableAgent {

    id:string;

    role:string;

    capability:number;

}






export class AgentCoordinator {


    private tasks:
        CoordinationTask[];


    private agents:
        AvailableAgent[];




    constructor(){

        this.tasks=[];

        this.agents=[];


        console.log(
            "[KLYN COORDINATION] Engine online"
        );

    }







    registerAgent(
        agent:AvailableAgent
    ){

        this.agents.push(
            agent
        );

    }







    createTask(
        objective:string,
        priority:
        CoordinationTask["priority"]
    ){


        const task:CoordinationTask = {


            id:
            crypto.randomUUID(),


            objective,


            priority,


            status:
            "pending"


        };


        this.tasks.push(
            task
        );


        return task;

    }







    selectAgent(
        role:string
    ){


        return this.agents

        .filter(
            agent =>
            agent.role === role
        )

        .sort(
            (a,b)=>
            b.capability -
            a.capability
        )[0];


    }







    assignTask(
        taskId:string,
        role:string
    ){


        const task =
            this.tasks.find(
                item =>
                item.id === taskId
            );


        const agent =
            this.selectAgent(
                role
            );


        if(
            task &&
            agent
        ){

            task.assignedAgent =
                agent.id;

            task.status =
                "running";

        }


        return task;

    }







    completeTask(
        taskId:string
    ){


        const task =
            this.tasks.find(
                item =>
                item.id === taskId
            );


        if(task){

            task.status =
                "completed";

        }


    }







    getState(){

        return {

            agents:
            this.agents,

            tasks:
            this.tasks

        };

    }


}
