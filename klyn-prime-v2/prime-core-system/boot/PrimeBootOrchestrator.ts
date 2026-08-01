export interface BootModule {

    name:string;

    start():Promise<void>;

}


export class PrimeBootOrchestrator {


    private modules:BootModule[] = [];


    register(module:BootModule){

        this.modules.push(module);

    }


    async boot(){

        console.log(
            "[KLYN PRIME] Boot sequence started"
        );


        for(const module of this.modules){

            console.log(
                `[BOOT] ${module.name}`
            );


            await module.start();

        }


        console.log(
            "[KLYN PRIME] All systems online"
        );

    }


    systems(){

        return this.modules.map(
            module => module.name
        );

    }

}
