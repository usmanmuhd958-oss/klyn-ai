export interface AgentPermission {


 agentId:string;

 permissions:string[];

}


export class PermissionManager {


 allow(
  agentId:string,
  permission:string
 ){

   return {

    agentId,

    permission,

    granted:true

   };

 }


}
