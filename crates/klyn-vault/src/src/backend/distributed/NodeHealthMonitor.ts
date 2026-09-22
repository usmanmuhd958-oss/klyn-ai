export class NodeHealthMonitor {


 check(node:any){

  return {

   node:node.id,

   healthy:node.status==="ACTIVE"

  };


 }


}
