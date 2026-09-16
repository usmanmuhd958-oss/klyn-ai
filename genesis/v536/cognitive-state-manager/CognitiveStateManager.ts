export class CognitiveStateManager {

  state:any={};

  set(value:any){
    this.state=value;
  }

  get(){
    return this.state;
  }
}
