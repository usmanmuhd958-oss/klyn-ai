export class SoftwareFactoryWorkflowCoordinator {
  coordinate(flow:any){
    return {
      flow,
      coordinated:true
    };
  }
}
