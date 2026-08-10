export class SystemModuleRegistry {

  register(module:any){
    return {
      registered:true,
      module
    };
  }

}
