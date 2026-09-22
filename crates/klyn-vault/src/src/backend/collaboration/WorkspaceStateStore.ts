export class WorkspaceStateStore {


 private state:any={};


 update(data:any){

  this.state=data;

 }


 get(){

  return this.state;

 }


}
