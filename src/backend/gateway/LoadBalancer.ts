export class LoadBalancer {


 private index = 0;


 select(nodes:string[]){

  if(nodes.length === 0)
   return null;


  const node =
   nodes[this.index % nodes.length];


  this.index++;


  return node;

 }


}
