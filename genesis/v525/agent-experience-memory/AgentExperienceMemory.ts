export class AgentExperienceMemory {

 remember(agent:string,event:string){

  return {
   agent,
   event,
   stored:true
  };

 }

}
