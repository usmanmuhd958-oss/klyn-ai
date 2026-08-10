export class CognitiveRuntimeBridge {

  connect(runtime:any){
    return {
      bridge:"active",
      runtime
    };
  }

}
