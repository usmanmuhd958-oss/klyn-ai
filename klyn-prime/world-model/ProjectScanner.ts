import { RealityGraph } from "./RealityGraph";


export class ProjectScanner {


constructor(
private graph:RealityGraph
){}


scan(files:string[]){

 for(const file of files){

  this.graph.addNode({

    id:crypto.randomUUID(),

    type:"file",

    name:file,

    metadata:{
      scanned:true
    }

  });

 }


}


}
