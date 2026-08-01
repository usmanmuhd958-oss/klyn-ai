export interface Capability {

    name:string;

    provider:string;

    status:string;

}


export class CapabilityRegistry {


    private capabilities =
        new Map<string, Capability>();


    register(
        capability:Capability
    ){

        this.capabilities.set(
            capability.name,
            capability
        );

    }


    find(
        name:string
    ){

        return this.capabilities.get(name);

    }


    list(){

        return [
            ...this.capabilities.values()
        ];

    }


}
