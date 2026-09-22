export class InfrastructureAnalyzer {

  analyze(environment:any){

    return {
      environment,
      analysis:"complete",
      risks:[]
    };

  }

}
