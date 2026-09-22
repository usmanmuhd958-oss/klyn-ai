export class ChangeExecutionEngine {


  execute(plan:any){

    return {

      plan,

      changed:true

    };

  }


}
