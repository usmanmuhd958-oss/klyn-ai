export class PlatformKernelManager {

  manage(kernel:any){
    return {
      status:"kernel_managed",
      kernel
    };
  }

}
