export class ConsensusEngine {
  evaluate(opinions:any[]){
    return {
      opinions,
      consensus:true
    };
  }
}
