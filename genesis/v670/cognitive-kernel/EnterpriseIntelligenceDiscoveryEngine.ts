export class EnterpriseIntelligenceDiscoveryEngine {

  discover(query:string){
    return {
      query,
      matches:"identified"
    };
  }

}
