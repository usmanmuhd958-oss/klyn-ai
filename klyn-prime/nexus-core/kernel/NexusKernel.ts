import { NexusRegistry } from "../registry/PrimeRegistry";
import { NexusBus } from "../communication/NexusBus";
import { NexusOrchestrator } from "../orchestration/NexusOrchestrator";
import { SystemHealth } from "../health/SystemHealth";
import { IntelligenceTelemetry } from "../telemetry/IntelligenceTelemetry";

export class NexusKernel {

  private registry: NexusRegistry;
  private bus: NexusBus;
  private orchestrator: NexusOrchestrator;
  private health: SystemHealth;
  private telemetry: IntelligenceTelemetry;

  constructor() {
    this.registry = new NexusRegistry();
    this.bus = new NexusBus();
    this.orchestrator = new NexusOrchestrator(this.bus);
    this.health = new SystemHealth();
    this.telemetry = new IntelligenceTelemetry();
  }


  boot() {

    this.telemetry.record(
      "kernel_boot",
      {
        status: "starting",
        time: Date.now()
      }
    );


    this.health.initialize();

    this.bus.initialize();

    this.orchestrator.initialize();


    this.telemetry.record(
      "kernel_ready",
      {
        status:"online"
      }
    );


    return {
      status:"NEXUS ONLINE",
      modules:this.registry.list()
    };

  }


  registerModule(
    name:string,
    module:any
  ){

    this.registry.register(
      name,
      module
    );

  }


  status(){

    return {
      health:this.health.status(),
      modules:this.registry.list(),
      telemetry:this.telemetry.snapshot()
    };

  }

}
