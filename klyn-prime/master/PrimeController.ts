import { SystemRegistry } from "./SystemRegistry";
import { IntelligenceCoordinator } from "./IntelligenceCoordinator";

export class PrimeController {

    private registry: SystemRegistry;
    private intelligence: IntelligenceCoordinator;

    constructor() {
        this.registry = new SystemRegistry();
        this.intelligence = new IntelligenceCoordinator();
    }


    async boot() {

        console.log(
          "[KLYN PRIME] Boot sequence started"
        );

        await this.registry.initialize();

        await this.intelligence.initialize();

        console.log(
          "[KLYN PRIME] System online"
        );
    }


    status() {

        return {
            system: "KLYN PRIME",
            state: "ACTIVE",
            modules:
              this.registry.listModules()
        };

    }
}
