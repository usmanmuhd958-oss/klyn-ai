export class DistributedAgentRouter {


 route(agent:string){

  return {

   agent,

   target:"optimal-node"

  };

 }


}
