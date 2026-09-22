export class KnowledgeGraph {


  private nodes:any[]=[];


  add(node:any){

    this.nodes.push(node);

  }


  query(){

    return this.nodes;

  }

}
