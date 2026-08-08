export class SimulationMemorySystem {

 history:any[]=[];

 store(result:any){

  this.history.push(result);

 }

}
