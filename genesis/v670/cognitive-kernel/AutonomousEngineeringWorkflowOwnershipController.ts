export class AutonomousEngineeringWorkflowOwnershipController {
  assign(workflow:any){
    return {
      workflow,
      ownership:"assigned"
    };
  }
}
