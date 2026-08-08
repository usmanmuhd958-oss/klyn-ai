
import {Planner} from "../reasoning/Planner";
import {AgentRegistry} from "../agents/AgentRegistry";
import {MemoryEngine} from "../memory/MemoryEngine";


export class MasterOrchestrator {


 constructor(
    private planner:Planner,
    private registry:AgentRegistry,
    private memory:MemoryEngine
 ){}


 async execute(goal:string){


    const plan =
       this.planner.createPlan(goal);


    this.memory.store({
       id:crypto.randomUUID(),
       type:"task",
       data:goal,
       created:Date.now()
    });


    return {

       goal,

       plan,

       agents:
          this.registry.list()

    };


 }


}

