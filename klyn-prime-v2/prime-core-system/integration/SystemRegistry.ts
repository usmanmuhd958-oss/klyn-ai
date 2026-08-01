export interface RegisteredSystem {

    name:string;

    category:string;

    version:string;

    status:"active"|"inactive";

}


export class SystemRegistry {


    private systems =
        new Map<string, RegisteredSystem>();


    register(system:RegisteredSystem){

        this.systems.set(
            system.name,
            system
        );

    }


    get(name:string){

        return this.systems.get(name);

    }


    list(){

        return [
            ...this.systems.values()
        ];

    }


}
