export class ResourceIntelligenceManager {

  allocate(resource:any){
    return {
      status:"resource_allocated",
      resource
    };
  }

}
