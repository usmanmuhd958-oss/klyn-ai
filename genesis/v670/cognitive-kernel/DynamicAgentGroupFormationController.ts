export class DynamicAgentGroupFormationController {
  form(agents:any[]){
    return {
      group:agents,
      formed:true
    };
  }
}
