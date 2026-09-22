export interface ProcedureRecord {

 id:string;

 name:string;

 steps:string[];

}


export class ProceduralMemory {


 private procedures:ProcedureRecord[]=[];


 register(
  procedure:ProcedureRecord
 ){

  this.procedures.push(
   procedure
  );

 }


 get(name:string){

  return this.procedures.find(
   p=>p.name===name
  );

 }


}
