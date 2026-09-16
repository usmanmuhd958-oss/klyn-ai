export class ResourceStrategyEngine {

 allocate(resource:string){

  return {
   resource,
   strategy:"optimized"
  };

 }

}
