export class IntelligenceRouter {

 route(message:any,target:any){

  return {
   routed:true,
   target,
   message
  };

 }

}
