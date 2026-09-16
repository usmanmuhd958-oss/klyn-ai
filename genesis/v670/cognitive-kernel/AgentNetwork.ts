export class AgentNetwork {

  nodes:any[]=[];

  register(agent:any){
    this.nodes.push(agent);
  }

  list(){
    return this.nodes;
  }

}
