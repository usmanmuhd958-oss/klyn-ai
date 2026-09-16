export class RuntimeOrchestrator {

 start(){

  return {
   runtime:"ACTIVE"
  };

 }


 stop(){

  return {
   runtime:"STOPPED"
  };

 }

}
