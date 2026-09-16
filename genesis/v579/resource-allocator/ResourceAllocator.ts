export class ResourceAllocator {
  allocate(resources:any){
    return {
      resources,
      optimized:true
    };
  }
}
