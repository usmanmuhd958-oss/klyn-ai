export class AgentCluster {

  members:any[]=[];

  add(agent:any){
    this.members.push(agent);
  }

  status(){
    return {
      size:this.members.length,
      state:"active"
    };
  }

}
