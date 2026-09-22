export class NodeCoordinator {

 private nodes:any[]=[];


 register(node:any){

  this.nodes.push(node);

  return {
   registered:true,
   node
  };

 }


 list(){

  return this.nodes;

 }

}
