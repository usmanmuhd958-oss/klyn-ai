export class SemanticContextResolver {
  resolve(data:string){
    return {
      status:"resolved",
      data
    };
  }
}
