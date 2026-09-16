export class CognitiveKernelEventBus {

  publish(event:string){
    return {
      event,
      routed:true
    };
  }

}
