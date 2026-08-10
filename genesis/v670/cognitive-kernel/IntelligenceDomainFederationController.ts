export class IntelligenceDomainFederationController {

  connect(domain:string){
    return {
      domain,
      connected:true
    };
  }

}
