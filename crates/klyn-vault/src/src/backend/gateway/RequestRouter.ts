export class RequestRouter {


 route(request:any){

  return {

   service: request.service || "default",

   path: request.path

  };

 }


}
