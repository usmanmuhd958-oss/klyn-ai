export class WorkflowDependencyResolver {

  resolve(dependencies:any){
    return {
      status:"dependency_resolution_active",
      dependencies
    };
  }

}
