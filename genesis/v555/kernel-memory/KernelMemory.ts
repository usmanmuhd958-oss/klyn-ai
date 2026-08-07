export class KernelMemory {

  store(event:string){
    return {
      event,
      memory:"persistent"
    };
  }

}
