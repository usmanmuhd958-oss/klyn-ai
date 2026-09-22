export class RecoveryManager {


  recover(issue:any){

    return {

      issue,

      action:"recovery-planned",

      status:"ready"

    };

  }


}
