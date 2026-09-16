export class RecoveryManager {


 async recover(issue:string){

   return {
     issue,
     action:"analysis_pending",
     timestamp:Date.now()
   };

 }


}
