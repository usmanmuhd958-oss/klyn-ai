export class RuntimeRecoveryOrchestrationController {
  restore(service:string){
    return {
      service,
      status:"restored"
    };
  }
}
