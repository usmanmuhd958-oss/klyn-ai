export class PlanningMemory {


 private history:any[]=[];


 store(plan:any){

  this.history.push(plan);

 }


 recall(){

  return this.history;

 }


}
