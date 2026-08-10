export class AgentConsensus {

  decide(proposals:any[]){
    return {
      selected: proposals[0] || null,
      consensus:true
    };
  }

}
