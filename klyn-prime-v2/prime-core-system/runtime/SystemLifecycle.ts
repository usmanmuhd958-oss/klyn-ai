export type SystemStatus =
    | "created"
    | "initializing"
    | "running"
    | "stopped"
    | "failed";


export interface SystemModule {

    name:string;

    initialize():Promise<void>;

    shutdown():Promise<void>;

    health():string;

}


export class SystemLifecycle {

    private modules = new Map<string, SystemModule>();

    private status = new Map<string, SystemStatus>();


    register(module:SystemModule){

        this.modules.set(
            module.name,
            module
        );

        this.status.set(
            module.name,
            "created"
        );
    }


    async start(name:string){

        const module =
            this.modules.get(name);


        if(!module)
            throw new Error(
                `System ${name} not found`
            );


        this.status.set(
            name,
            "initializing"
        );


        try{

            await module.initialize();


            this.status.set(
                name,
                "running"
            );


        }catch(error){

            this.status.set(
                name,
                "failed"
            );

            throw error;
        }
    }


    getStatus(name:string){

        return this.status.get(name);
    }


    list(){

        return [
            ...this.modules.keys()
        ];
    }


    async stop(name:string){

        const module =
            this.modules.get(name);


        if(module){

            await module.shutdown();


            this.status.set(
                name,
                "stopped"
            );
        }
    }
}
