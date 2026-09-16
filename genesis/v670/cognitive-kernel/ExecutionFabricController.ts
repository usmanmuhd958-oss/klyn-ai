import {ExecutionCoordinator} from "./ExecutionCoordinator";

export class ExecutionFabricController {

  boot(){
    const engine=new ExecutionCoordinator();

    return {
      layer:"V721",
      execution:engine.coordinate()
    };
  }

}
