export interface Capability {

    name:string;

    level:number;

    dependencies:string[];

}


export class CapabilityGraph {


    private capabilities:Map<string,Capability>;


    constructor(){

        this.capabilities =
        new Map();

    }


    add(capability:Capability){

        this.capabilities.set(
            capability.name,
            capability
        );

    }



    resolve(name:string){

        return this.capabilities.get(name);

    }



    list(){

        return [
            ...this.capabilities.values()
        ];

    }

}
