export class AgentVersionManager {

 createVersion(agent:string){

  return {
   agent,
   version:Date.now()
  };

 }

}
