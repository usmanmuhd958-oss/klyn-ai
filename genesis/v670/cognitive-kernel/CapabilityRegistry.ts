import { AgentCapability }
from "./AgentCapability";


export class CapabilityRegistry {

 private capabilities =
   new Map<string,AgentCapability>();


 register(
  id:string,
  capability:AgentCapability
 ){

  this.capabilities.set(
    id,
    capability
  );

 }


 discover(skill:string){

  return [
   ...this.capabilities.entries()
  ]
  .filter(
   ([,cap]) =>
   cap.skills.includes(skill)
  );

 }


 list(){

  return [
   ...this.capabilities.keys()
  ];

 }

}
