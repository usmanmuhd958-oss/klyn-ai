export class RollbackManager {


 rollback(version:string){

  return {

   rollback:true,

   target:version

  };


 }


}
