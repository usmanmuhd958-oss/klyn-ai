import { CapabilityRegistry }
from "./CapabilityRegistry";


export class AgentSelector {


 constructor(
  private registry:CapabilityRegistry
 ){}


 select(task:string){

  const matches =
    this.registry.discover(task);


  return {
    task,
    candidates:
      matches.map(
       m => m[0]
      ),
    strategy:
      "capability-match"
  };

 }

}
