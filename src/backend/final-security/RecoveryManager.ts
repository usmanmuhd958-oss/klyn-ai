export class RecoveryManager {

  recover(failure:any){

    return {
      recovered:true,
      failure
    };

  }

}
