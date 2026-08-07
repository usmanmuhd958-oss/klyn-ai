export class ConsciousnessStateLayer {

  state={
    awareness:0,
    activity:"idle"
  };

  update(data:any){
    this.state=data;
  }

  get(){
    return this.state;
  }
}
