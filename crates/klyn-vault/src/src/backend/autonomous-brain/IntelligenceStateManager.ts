export class IntelligenceStateManager {

  private state:any = {};

  update(data:any){

    this.state = {
      ...this.state,
      ...data
    };

  }


  get(){

    return this.state;

  }

}
