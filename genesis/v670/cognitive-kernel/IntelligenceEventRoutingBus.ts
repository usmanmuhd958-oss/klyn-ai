export class IntelligenceEventRoutingBus {
  route(event:any){
    return {
      event,
      routed:true
    };
  }
}
