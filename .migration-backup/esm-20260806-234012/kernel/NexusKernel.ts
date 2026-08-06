import { PrimeRegistry } from "../registry/PrimeRegistry";
import { NexusBus } from "../communication/NexusBus";
import { NexusOrchestrator } from "../orchestration/NexusOrchestrator";
import { SystemHealth } from "../health/SystemHealth";
import { IntelligenceTelemetry } from "../telemetry/IntelligenceTelemetry";

export class NexusKernel {

    private registry: PrimeRegistry;
    private bus: NexusBus;
    private orchestrator: NexusOrchestrator;
    private health: SystemHealth;
    private telemetry: IntelligenceTelemetry;

    constructor() {

        this.registry = new PrimeRegistry();
        this.bus = new NexusBus();
        this.health = new SystemHealth();
        this.telemetry = new IntelligenceTelemetry();

        this.orchestrator =
            new NexusOrchestrator(
                this.registry,
                this.bus
            );
    }


    async boot(){

        console.log(
            "[NEXUS] Booting Prime Intelligence Kernel..."
        );

        this.health.initialize();

        this.telemetry.record(
            "kernel_boot",
            {
                timestamp:
                Date.now()
            }
        );

        await this.orchestrator.initialize();


        console.log(
            "[NEXUS] Kernel online"
        );
    }


    getRegistry(){
        return this.registry;
    }


    getBus(){
        return this.bus;
    }

}
