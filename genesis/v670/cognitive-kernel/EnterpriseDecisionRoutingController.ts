export class EnterpriseDecisionRoutingController {

  route(decision:string){
    return {
      decision,
      routed:true
    };
  }

}
