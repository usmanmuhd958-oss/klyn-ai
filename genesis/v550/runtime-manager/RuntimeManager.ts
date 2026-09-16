export class RuntimeManager {
  manage(process:string){
    return {
      process,
      running:true
    };
  }
}
