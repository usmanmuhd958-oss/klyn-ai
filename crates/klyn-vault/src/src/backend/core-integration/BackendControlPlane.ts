export class BackendControlPlane {

 control(action:string){

  return {

   action,

   executed:true

  };

 }

}
