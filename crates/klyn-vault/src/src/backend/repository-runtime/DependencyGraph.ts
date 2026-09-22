export class DependencyGraph {

  nodes:any[]=[];


  add(node:any){

    this.nodes.push(node);

  }


  get(){

    return this.nodes;

  }

}
