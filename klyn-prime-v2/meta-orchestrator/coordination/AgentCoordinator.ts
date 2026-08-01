export class AgentCoordinator {


    assign(agent:string,task:string){

        return {

            agent,

            task,

            status:"assigned"

        };

    }


}
