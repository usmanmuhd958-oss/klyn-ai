export class RateLimitEngine {

 enforce(request:string){
   return {
    request,
    decision:"allowed"
   };
 }

}
