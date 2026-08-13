export class AuditTrail {

 private logs:any[]=[];


 record(event:any){

  this.logs.push({
   ...event,
   timestamp:Date.now()
  });

 }


 getLogs(){

  return this.logs;

 }

}
