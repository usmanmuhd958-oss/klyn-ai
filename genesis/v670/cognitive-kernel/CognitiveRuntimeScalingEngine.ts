export class CognitiveRuntimeScalingEngine {
  distribute(resources:any){
    return {
      resources,
      distributed:true
    };
  }
}
