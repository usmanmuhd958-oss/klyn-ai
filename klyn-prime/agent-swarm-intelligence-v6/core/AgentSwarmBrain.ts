/**
 * KLYN Prime Autonomous Agent Swarm Intelligence v6
 *
 * Multi-agent collaboration foundation.
 */


export type AgentRole =
    | "researcher"
    | "developer"
    | "security"
    | "reviewer"
    | "deployment";



export type AgentStatus =
    | "idle"
    | "working"
    | "offline";



export interface SwarmAgent {

    id:string;

    name:string;

    role:AgentRole;

    status:AgentStatus;

    capabilities:string[];

}



export interface SwarmTask {

    id:string;

    objective:string;

    requiredRole:AgentRole;

    priority:number;

    createdAt:number;

}



export interface AgentMessage {

    id:string;

    from:string;

    to:string;

    message:string;

    timestamp:number;

}







export class AgentSwarmBrain {


    private agents:
        SwarmAgent[];


    private tasks:
        SwarmTask[];


    private messages:
        AgentMessage[];




    constructor(){

        this.agents=[];

        this.tasks=[];

        this.messages=[];


        console.log(
            "[KLYN AGENT SWARM INTELLIGENCE v6] Online"
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
        task:SwarmTask
    ){

        this.tasks.push(
            task
        );


        return task;

    }







    assignTask(
        taskId:string
    ){

        const task =
            this.tasks.find(

                item =>
                item.id === taskId

            );


        if(!task){

            return null;

        }



        const agent =
            this.agents.find(

                item =>
                item.role === task.requiredRole
                &&
                item.status === "idle"

            );



        if(agent){

            agent.status =
            "working";

        }



        return {

            task,

            assignedAgent:
            agent ?? null

        };

    }







    sendMessage(
        message:AgentMessage
    ){

        this.messages.push(
            message
        );


        return message;

    }







    swarmState(){

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
