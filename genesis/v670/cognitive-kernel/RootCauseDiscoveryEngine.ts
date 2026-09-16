export class RootCauseDiscoveryEngine {
  discover(problem:any){
    return {
      problem,
      rootCause:"analyzed"
    };
  }
}
