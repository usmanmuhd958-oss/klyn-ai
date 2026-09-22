export class LoadBalancer {

 distribute(nodes:string[]){

  return nodes[0] ?? null;

 }

}
