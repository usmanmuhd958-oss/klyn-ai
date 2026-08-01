export interface PrimeAgent {

    id:string;

    role:string;

    execute(task:any):Promise<any>;

}


export class AgentRuntime {


    private agents =
        new Map<string, PrimeAgent>();


    register(agent:PrimeAgent){

        this.agents.set(
            agent.id,
            agent
        );

    }


    findByRole(role:string){

        return [
            ...this.agents.values()
        ]
        .find(
            agent =>
            agent.role === role
        );

    }


    list(){

        return [
            ...this.agents.values()
        ];

    }

}
