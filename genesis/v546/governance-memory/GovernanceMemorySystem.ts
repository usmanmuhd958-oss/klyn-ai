export class GovernanceMemorySystem {
  store(event:string){
    return {
      event,
      saved:true
    };
  }
}
