export class GatewayMiddleware {


 process(context:any){

  return {

   processed:true,

   context

  };


 }


}
