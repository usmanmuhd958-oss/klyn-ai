export class GenesisRegistry {

    private capabilities = new Map<string, any>();

    register(name:string, capability:any){

        this.capabilities.set(
            name,
            capability
        );

        console.log(
            `[GENESIS REGISTERED] ${name}`
        );
    }


    list(){

        return [
            ...this.capabilities.keys()
        ];
    }
}
