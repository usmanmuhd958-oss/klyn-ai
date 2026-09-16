export class BottleneckDetector {
  detect(system:any){
    return {
      system,
      bottleneck:false
    };
  }
}
