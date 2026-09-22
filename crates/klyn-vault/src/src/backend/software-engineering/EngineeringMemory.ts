export class EngineeringMemory {

 private records:any[]=[];


 store(data:any){

  this.records.push(data);

 }


 recall(){

  return this.records;

 }

}
