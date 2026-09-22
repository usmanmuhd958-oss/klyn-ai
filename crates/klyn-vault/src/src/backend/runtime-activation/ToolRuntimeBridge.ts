export class ToolRuntimeBridge {

  async run(tool:any){

    return {
      tool,
      status:"available"
    };

  }

}
