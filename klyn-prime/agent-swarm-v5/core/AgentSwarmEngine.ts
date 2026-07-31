/**
 * KLYN Prime Agent Swarm Intelligence v5
 *
 * Multi-agent collaboration foundation.
 */


export type AgentRole =
    | "architect"
    | "developer"
    | "researcher"
    | "security"
    | "tester"
    | "reviewer"
    | "optimizer";



export interface SwarmAgent {

    id:string;

    name:string;

    role:AgentRole;

    capability:string[];

    active:boolean;

}



export interface AgentMessage {

    id:string;

    from:string;

    to:string;

    content:string;

    priority:number;

    timestamp:number;

}



export interface SwarmTask {

    id:string;

    objective:string;

    assignedAgents:string[];

    status:
        | "created"
        | "running"
        | "completed";

}







export class AgentSwarmEngine {


    private agents:
        SwarmAgent[];


    private messages:
        AgentMessage[];


    private tasks:
        SwarmTask[];




    constructor(){

        this.agents=[];

        this.messages=[];

        this.tasks=[];


        console.log(
            "[KLYN AGENT SWARM INTELLIGENCE v5] Online"
        );

    }







    registerAgent(
        agent:SwarmAgent
    ){

        this.agents.push(
            agent
        );


        return agent;

    }







    createTask(
        objective:string
    ){

        const task:SwarmTask = {


            id:
            crypto.randomUUID(),


            objective,


            assignedAgents:
            [],


            status:
            "created"


        };


        this.tasks.push(
            task
        );


        return task;

    }







    assignAgent(
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


        return task;

    }







    sendMessage(
        message:AgentMessage
    ){

        this.messages.push(
            message
        );


        return message;

    }







    coordinate(
        taskId:string
    ){

        const task =
            this.tasks.find(

                item =>
                item.id === taskId

            );


        if(task){

            task.status =
                "running";

        }


        return {

            task,

            agents:
            this.agents.filter(

                agent =>
                task?.assignedAgents.includes(
                    agent.id
                )

            )

        };

    }







    swarmStatus(){

        return {

            agents:
            this.agents,


            tasks:
            this.tasks,


            messages:
            this.messages,


            timestamp:
            Date.now()

        };

    }



}
