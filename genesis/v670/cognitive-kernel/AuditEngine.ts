export class AuditEngine {

 record(event:string){

   return {
     event,
     timestamp:Date.now()
   };

 }

}
