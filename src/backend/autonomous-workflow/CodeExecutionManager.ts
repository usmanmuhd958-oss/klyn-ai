export class CodeExecutionManager {

  execute(task:any){

    return {

      task,

      status:"executed",

      output:"completed"

    };

  }

}
