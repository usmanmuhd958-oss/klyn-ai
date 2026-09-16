export class ClusterState {


 private state = "INITIALIZING";


 update(state:string){

  this.state = state;

 }


 get(){

  return this.state;

 }


}
