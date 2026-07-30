export class SystemKernel {

    private modules: Map<string, any>;

    constructor(){
        this.modules = new Map();
    }


    registerModule(
        name:string,
        module:any
    ){
        this.modules.set(name,module);

        console.log(
            `[KLYN PRIME] Module registered: ${name}`
        );
    }


    getModule(name:string){

        return this.modules.get(name);

    }


    listModules(){

        return Array.from(
            this.modules.keys()
        );

    }


    async boot(){

        console.log(
            "KLYN PRIME SYSTEM BOOTING..."
        );


        for(
            const module of this.modules.values()
        ){

            if(module.initialize){

                await module.initialize();

            }

        }


        console.log(
            "KLYN PRIME ONLINE"
        );

    }

}
