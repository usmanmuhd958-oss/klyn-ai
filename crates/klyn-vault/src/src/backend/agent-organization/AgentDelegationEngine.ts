export class AgentDelegationEngine {


  delegate(task:any){

    return {

      task,

      delegated:true,

      agent:"selected"

    };

  }


}
