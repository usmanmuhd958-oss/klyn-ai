import { RuntimeModule } from "../core/PrimeRuntime";


export class ModuleRegistry {

    private registry =
        new Map<string, RuntimeModule>();


    add(module: RuntimeModule) {

        this.registry.set(
            module.name,
            module
        );
    }


    get(name:string){

        return this.registry.get(name);

    }


    list(){

        return [
            ...this.registry.keys()
        ];

    }
}
