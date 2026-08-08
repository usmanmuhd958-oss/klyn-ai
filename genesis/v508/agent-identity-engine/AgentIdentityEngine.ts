export class AgentIdentityEngine {

 createIdentity(name:string,role:string){

  return {
   id:crypto.randomUUID(),
   name,
   role
  };

 }

}
