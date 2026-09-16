export class KernelFusionCore {

  fuse(layers:string[]){
    return {
      layers,
      fusion:"active"
    };
  }

}
