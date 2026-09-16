export class EnterpriseCognitiveExecutionController {

  execute(operation:any){
    return {
      operation,
      executionStarted:true
    };
  }

}
