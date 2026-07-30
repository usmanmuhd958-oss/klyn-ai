import {PrimeAgent} from "./PrimeAgent";


export class AgentRegistry {


    private agents =
    new Map<string,PrimeAgent>();


    register(agent:PrimeAgent){

        this.agents.set(
            agent.id,
            agent
        );

    }


    get(id:string){

        return this.agents.get(id);

    }


    list(){

        return [
            ...this.agents.keys()
        ];

    }

}
