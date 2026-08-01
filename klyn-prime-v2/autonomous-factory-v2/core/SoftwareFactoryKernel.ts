export interface FactoryTask {

    id:string;

    type:string;

    description:string;

}


export class SoftwareFactoryKernel {


    private agents = new Map<string, any>();


    registerAgent(name:string, agent:any){

        this.agents.set(name, agent);

    }


    execute(task:FactoryTask){

        const agent = this.agents.get(task.type);


        if(!agent){

            return {

                success:false,

                error:"No agent available"

            };

        }


        return agent.run(task);

    }


}
