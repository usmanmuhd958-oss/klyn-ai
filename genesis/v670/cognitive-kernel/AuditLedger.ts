export class AuditLedger {

 private records:string[]=[];

 record(event:string){

   this.records.push(event);

 }

 list(){

   return this.records;

 }

}
