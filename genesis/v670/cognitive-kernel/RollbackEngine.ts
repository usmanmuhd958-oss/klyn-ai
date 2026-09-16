export class RollbackEngine {

 rollback(version:string){

  return {
   version,
   action:"rollback_completed"
  };

 }

}
