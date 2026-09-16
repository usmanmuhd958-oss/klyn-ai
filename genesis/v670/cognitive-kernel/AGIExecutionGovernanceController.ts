export class AGIExecutionGovernanceController {
  govern(policy:any){
    return {
      policy,
      governance:"enabled"
    };
  }
}
