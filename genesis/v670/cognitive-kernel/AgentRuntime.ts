import { AgentIdentity }
from "./AgentIdentity";


export class AgentRuntime {

 constructor(
   private identity:AgentIdentity
 ){}


 describe(){

   return {
     agent:this.identity.name,
     role:this.identity.role,
     capabilities:
       this.identity.capabilities,
     status:"ready"
   };

 }


 execute(task:any){

   return {
     agent:this.identity.id,
     task,
     status:"executed"
   };

 }

}
