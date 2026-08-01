export class HealthCoordinator {


    check(system:any){

        if(
            typeof system.health === "function"
        ){

            return system.health();

        }


        return "unknown";

    }


    scan(systems:any[]){

        return systems.map(
            system => ({
                name:system.name,
                health:this.check(system)
            })
        );

    }

}
