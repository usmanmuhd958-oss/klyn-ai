export class SystemRegistry {

    private modules =
        new Map<string, unknown>();


    async initialize(){

        console.log(
          "[REGISTRY] Initializing modules"
        );

    }


    register(
        name:string,
        module:unknown
    ){

        this.modules.set(
            name,
            module
        );

    }


    get(name:string){

        return this.modules.get(name);

    }


    listModules(){

        return [
            ...this.modules.keys()
        ];

    }
}
