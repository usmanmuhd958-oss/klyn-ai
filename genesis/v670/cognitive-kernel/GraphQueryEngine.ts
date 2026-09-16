export class GraphQueryEngine {

 query(nodes:any[], type:string){

  return nodes.filter(
   n=>n.type===type
  );

 }

}
