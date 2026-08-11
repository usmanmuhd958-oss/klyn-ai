export class EnterpriseCognitiveKernelSynchronizationController {
  synchronize(kernel:any){
    return {
      kernel,
      synchronized:true
    };
  }
}
