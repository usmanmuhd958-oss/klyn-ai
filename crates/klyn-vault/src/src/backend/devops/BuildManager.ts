export class BuildManager {

 build(project:string){

  return {
   project,
   status:"BUILD_SUCCESS",
   timestamp:Date.now()
  };

 }

}
