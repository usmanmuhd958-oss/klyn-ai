export class IntelligentServiceExecutionLayer {

  execute(service:any){
    return {
      status:"service_execution_complete",
      service
    };
  }

}
