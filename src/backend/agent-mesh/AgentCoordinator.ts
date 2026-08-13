import {AgentMessageBus} from "./AgentMessageBus.js";


export class AgentCoordinator {


  bus = new AgentMessageBus();


  coordinate(task:any){

    return this.bus.send({

      task,

      status:"assigned"

    });

  }


}
