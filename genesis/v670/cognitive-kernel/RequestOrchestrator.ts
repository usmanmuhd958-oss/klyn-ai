export class RequestOrchestrator {

 process(request:string){
  return {
   request,
   orchestrated:true
  };
 }

}
