export class IncidentMemory {

 incidents:any[]=[];

 record(event:any){

  this.incidents.push(event);

 }

}
