export class CapabilityExchange {
  exchange(source:any,target:any){
    return {
      source,
      target,
      transferred:true
    };
  }
}
