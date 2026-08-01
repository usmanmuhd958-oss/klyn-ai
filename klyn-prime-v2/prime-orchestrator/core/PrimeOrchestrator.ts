
export class PrimeOrchestrator {

    private systems:any[] = [];

    registerSystem(system:any){

        this.systems.push(system);

    }


    getSystems(){

        return this.systems;

    }


    async execute(goal:string){

        return {
            goal,
            systemsActivated:this.systems.length,
            status:"processing"
        };

    }

}

