export interface AgentCapability {

    name:string;

    execute(input:any):Promise<any>;

}


export class PrimeAgent {


    id:string;

    capabilities:AgentCapability[] = [];


    constructor(id:string){

        this.id=id;

    }


    addCapability(
        capability:AgentCapability
    ){

        this.capabilities.push(capability);

    }


    async run(input:any){

        const results=[];


        for(const capability of this.capabilities){

            results.push(
                await capability.execute(input)
            );

        }


        return {

            agent:this.id,

            results

        };

    }

}
