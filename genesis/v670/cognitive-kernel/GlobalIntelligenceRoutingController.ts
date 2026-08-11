export class GlobalIntelligenceRoutingController {
  route(request:any){
    return {
      request,
      routed:true
    };
  }
}
