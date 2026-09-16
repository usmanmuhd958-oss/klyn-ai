export class StateSync {
  synchronize(states:string[]){
    return {
      states,
      synchronized:true
    };
  }
}
