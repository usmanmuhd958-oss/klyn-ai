export class ResourceAllocationDecisionController {

  allocate(target:any){
    return {
      status:"resource_allocation_active",
      target
    };
  }

}
