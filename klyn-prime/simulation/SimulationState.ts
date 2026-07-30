export interface SimulationState {

  id:string;

  timestamp:number;

  changes:string[];

  predictions:string[];

  riskLevel:"low"|"medium"|"high";

}


export class SimulationStateStore {


private states:SimulationState[] = [];


save(state:SimulationState){

 this.states.push(state);

}


history(){

 return this.states;

}


}
