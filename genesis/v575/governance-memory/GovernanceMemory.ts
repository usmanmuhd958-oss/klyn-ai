export class GovernanceMemory {
  remember(event:any){
    return {
      event,
      stored:true
    };
  }
}
