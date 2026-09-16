export class EnterpriseConnectorOrchestrationEngine {

  connect(service:any){
    return {
      status:"connector_orchestration_active",
      service
    };
  }

}
