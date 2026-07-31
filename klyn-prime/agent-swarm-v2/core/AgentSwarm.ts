/**
 * KLYN Prime Agent Swarm Intelligence v2
 *
 * Multi-agent coordination foundation.
 */


export type AgentStatus =
    | "idle"
    | "working"
    | "offline";



export interface AgentProfile {

    id:string;

    name:string;

    capability:string[];

    score:number;

    status:AgentStatus;

    createdAt:number;

}



export interface SwarmTask {

    id:string;

    objective:string;

    requiredCapability:string;

    assignedAgent?:string;

    status:
        | "created"
        | "assigned"
        | "completed";

}







export class AgentSwarm {


    private agents:
        AgentProfile[];


    private tasks:
        SwarmTask[];




    constructor(){

        this.agents=[];

        this.tasks=[];


        console.log(
            "[KLYN AGENT SWARM v2] Online"
        );

    }







    registerAgent(
        agent:AgentProfile
    ){

        this.agents.push(
            agent
        );


        return agent;

    }







    createTask(
        objective:string,
        requiredCapability:string
    ){


        const task:SwarmTask = {


            id:
            crypto.randomUUID(),


            objective,


            requiredCapability,


            status:
            "created"


        };


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


        if(!task)
            return null;



        const agent =
            this.agents.find(

                item =>

                item.capability.includes(
                    task.requiredCapability
                )
                &&
                item.status === "idle"

            );



        if(agent){

            task.assignedAgent =
                agent.id;


            task.status =
                "assigned";


            agent.status =
                "working";


        }


        return task;

    }







    updateReputation(
        agentId:string,
        improvement:number
    ){

        const agent =
            this.agents.find(
                item =>
                item.id === agentId
            );


        if(agent){

            agent.score += improvement;

        }


        return agent;

    }







    getSwarmState(){

        return {

            agents:
            this.agents,


            tasks:
            this.tasks,


            timestamp:
            Date.now()

        };

    }



}
