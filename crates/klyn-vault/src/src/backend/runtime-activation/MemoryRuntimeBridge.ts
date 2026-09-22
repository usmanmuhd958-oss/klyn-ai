export class MemoryRuntimeBridge {

  async retrieve(context:any){

    return {
      context,
      memory:"connected"
    };

  }

}
