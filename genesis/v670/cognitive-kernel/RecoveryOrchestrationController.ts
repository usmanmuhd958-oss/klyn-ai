export class RecoveryOrchestrationController {

  recover(issue:any){
    return {
      status:"recovery_orchestration_active",
      issue
    };
  }

}
