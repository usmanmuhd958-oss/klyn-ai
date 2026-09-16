export class EnterpriseIntelligenceMeshRouter {

  route(signal:any){
    return {
      status:"enterprise_signal_routed",
      signal
    };
  }

}
