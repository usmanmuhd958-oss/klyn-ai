export class FileRelationshipGraph {


 private graph:Record<string,string[]>={};


 connect(
  file:string,
  dependency:string
 ){

  if(!this.graph[file]){
   this.graph[file]=[];
  }

  this.graph[file].push(dependency);

 }


 get(){

  return this.graph;

 }


}
