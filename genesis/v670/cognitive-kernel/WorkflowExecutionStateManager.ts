export class WorkflowExecutionStateManager {

  state="initialized";

  update(next:string){
    this.state = next;
    return this.state;
  }

}
