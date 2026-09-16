export class GlobalAgentGovernanceController {

  govern(agents:any[]){
    return {
      agents,
      governanceEnabled:true
    };
  }

}
