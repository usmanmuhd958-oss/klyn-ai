import { PrimeRegistry } from "../registry/PrimeRegistry";
import { NexusBus } from "../communication/NexusBus";
import { SystemHealth } from "../health/SystemHealth";
import { IntelligenceTelemetry } from "../telemetry/IntelligenceTelemetry";


export class NexusKernel {

  private registry: PrimeRegistry;
  private bus: NexusBus;
  private health: SystemHealth;
  private telemetry: IntelligenceTelemetry;

  private running: boolean;


  constructor() {

    this.registry = new PrimeRegistry();
    this.bus = new NexusBus();
    this.health = new SystemHealth();
    this.telemetry = new IntelligenceTelemetry();

    this.running = false;

  }


  boot(): void {

    if (this.running) {
      return;
    }


    this.running = true;


    this.telemetry.record(
      "kernel_boot",
      {
        timestamp: Date.now()
      }
    );


    this.bus.publish(
      "kernel.started",
      {
        status: "online"
      }
    );


    console.log(
      "[NEXUS KERNEL] System online"
    );

  }



  shutdown(): void {


    this.running = false;


    this.bus.publish(
      "kernel.shutdown",
      {
        status:"offline"
      }
    );


    console.log(
      "[NEXUS KERNEL] Shutdown complete"
    );

  }



  registerModule(module:any){

    this.registry.register(module);


    this.telemetry.record(
      "module_registered",
      {
        module: module.id
      }
    );

  }



  status(){

    return {

      running:this.running,

      modules:
        this.registry.list(),

      health:
        this.health.check()

    };

  }



  getRegistry(){

    return this.registry;

  }


  getBus(){

    return this.bus;

  }

}
