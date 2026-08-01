import { ModuleRegistry } from "../modules/ModuleRegistry";
import { EventBus } from "../events/EventBus";


export class PrimeKernel {

  public modules: ModuleRegistry;

  public events: EventBus;


  constructor(){

    this.modules = new ModuleRegistry();

    this.events = new EventBus();

  }


  async boot(){

    console.log(
      "KLYN PRIME KERNEL ONLINE"
    );

    await this.modules.initializeAll();

  }

}
