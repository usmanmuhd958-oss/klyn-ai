export class IntelligenceRouter {
  route(request:string){
    return {
      request,
      routed:true
    };
  }
}
