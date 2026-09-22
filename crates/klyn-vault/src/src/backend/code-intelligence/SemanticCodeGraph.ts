export class SemanticCodeGraph {


 private graph:any = {};


 connect(
  from:string,
  to:string
 ){

  this.graph[from]=
   this.graph[from] || [];

  this.graph[from].push(to);

 }


 get(){

  return this.graph;

 }


}
