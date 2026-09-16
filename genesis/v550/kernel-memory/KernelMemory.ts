export class KernelMemory {
  remember(data:string){
    return {
      data,
      stored:true
    };
  }
}
