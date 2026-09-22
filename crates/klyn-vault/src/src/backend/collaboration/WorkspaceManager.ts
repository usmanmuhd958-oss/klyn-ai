export class WorkspaceManager {

 private workspaces = new Map<string, any>();

 create(id:string){

  const workspace={
   id,
   files:[]
  };

  this.workspaces.set(id,workspace);

  return workspace;

 }


 get(id:string){

  return this.workspaces.get(id);

 }

}
