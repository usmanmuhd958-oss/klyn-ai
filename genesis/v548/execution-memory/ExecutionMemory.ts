export class ExecutionMemory {
  remember(result:string){
    return {
      result,
      saved:true
    };
  }
}
