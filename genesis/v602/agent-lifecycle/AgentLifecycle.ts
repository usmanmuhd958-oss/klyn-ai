export class AgentLifecycle {

 status="created";

 update(state:string){

  this.status=state;

  return this.status;

 }

}
