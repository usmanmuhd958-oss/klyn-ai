export class ContainerOrchestrator {


 deploy(service:string){

  return {

   service,

   container:"STARTED"

  };


 }


 stop(service:string){

  return {

   service,

   container:"STOPPED"

  };


 }


}
