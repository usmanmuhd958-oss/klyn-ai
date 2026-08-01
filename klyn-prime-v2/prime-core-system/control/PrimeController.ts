import { SystemStateManager } from "./SystemStateManager";
import { HealthCoordinator } from "./HealthCoordinator";


export class PrimeController {


    private stateManager:
        SystemStateManager;


    private health:
        HealthCoordinator;


    constructor(){

        this.stateManager =
            new SystemStateManager();


        this.health =
            new HealthCoordinator();

    }


    registerSystem(system:any){

        this.stateManager.update({

            name: system.name,

            status: "registered"

        });

    }


    evaluate(systems:any[]){

        const report =
            this.health.scan(systems);


        for(const item of report){

            this.stateManager.update({

                name:item.name,

                status:item.health

            });

        }


        return report;

    }


    status(){

        return this.stateManager.snapshot();

    }

}
