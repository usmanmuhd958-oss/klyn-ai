export class AuditLogger {


 private logs:any[]=[];


 record(event:any){

  this.logs.push({

   ...event,

   timestamp:Date.now()

  });


 }


 history(){

  return this.logs;

 }


}
