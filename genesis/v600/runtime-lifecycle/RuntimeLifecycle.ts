export class RuntimeLifecycle {

 state="initialized";

 transition(next:string){

  this.state=next;

  return this.state;

 }

}
