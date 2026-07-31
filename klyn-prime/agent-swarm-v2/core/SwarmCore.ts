/**
 * KLYN Prime Agent Swarm Core
 *
 * Multi-agent coordination foundation.
 */


export type AgentRole =
    | "architect"
    | "coder"
    | "debugger"
    | "researcher"
    | "tester"
    | "reviewer";



export interface SwarmAgent {

    id:string;

    name:string;

    role:AgentRole;

    status:
        | "idle"
        | "working"
        | "completed";

    capability:number;

}




export interface SwarmTask {

    id:string;

    objective:string;

    assignedAgents:string[];

}




export class SwarmCore {


    private agents:
        SwarmAgent[];


    private tasks:
        SwarmTask[];




    constructor(){

        this.agents=[];

        this.tasks=[];

        console.log(
            "[KLYN SWARM] Core initialized"
        );

    }







    registerAgent(
        agent:SwarmAgent
    ){

        this.agents.push(
            agent
        );

    }







    createTask(
        objective:string
    )
    :
    SwarmTask {


        const task:SwarmTask = {


            id:
            crypto.randomUUID(),


            objective,


            assignedAgents:
            []

        };



        this.tasks.push(
            task
        );


        return task;

    }







    assign(
        taskId:string,
        agentId:string
    ){


        const task =
            this.tasks.find(
                item =>
                item.id === taskId
            );


        if(task){

            task.assignedAgents.push(
                agentId
            );

        }

    }







    status(){

        return {


            agents:
            this.agents,


            tasks:
            this.tasks

        };

    }


}
