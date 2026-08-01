import { AgentRuntime } from "./AgentRuntime";


export class AgentDispatcher {


    constructor(
        private runtime:AgentRuntime
    ){}


    async dispatch(
        role:string,
        task:any
    ){


        const agent =
            this.runtime.findByRole(role);


        if(!agent){

            throw new Error(
                `No agent available for role: ${role}`
            );

        }


        return await agent.execute(task);

    }


    availableAgents(){

        return this.runtime.list();

    }

}
