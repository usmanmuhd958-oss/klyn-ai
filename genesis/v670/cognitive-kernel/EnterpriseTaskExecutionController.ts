export class EnterpriseTaskExecutionController {
  execute(task:any){
    return {
      task,
      executed:true
    };
  }
}
