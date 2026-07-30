import {PrimeAgent} from "../core/PrimeAgent";


export class AgentExecutor {


    async execute(
        agent:PrimeAgent,
        task:any
    ){

        return await agent.run(task);

    }

}
