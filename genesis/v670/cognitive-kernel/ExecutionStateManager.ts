export class ExecutionStateManager {
  private state="ready";

  update(state:string){
    this.state=state;
    return this.state;
  }

  get(){
    return this.state;
  }
}
