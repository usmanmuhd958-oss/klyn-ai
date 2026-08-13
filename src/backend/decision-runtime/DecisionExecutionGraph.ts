export class DecisionExecutionGraph {

  nodes:any[]=[];


  add(node:any){

    this.nodes.push(node);

  }


  getGraph(){

    return this.nodes;

  }

}
