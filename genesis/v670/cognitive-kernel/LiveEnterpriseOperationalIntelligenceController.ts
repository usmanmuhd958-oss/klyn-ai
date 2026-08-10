export class LiveEnterpriseOperationalIntelligenceController {

  analyze(environment:any){
    return {
      environment,
      operationalIntelligenceActive:true
    };
  }

}
