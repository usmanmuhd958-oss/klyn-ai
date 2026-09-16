export class CoreOrchestrator {

  coordinate(module:string){
    return {
      module,
      coordination:"enabled"
    };
  }

}
