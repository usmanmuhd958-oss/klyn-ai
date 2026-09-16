export class ResilienceCore {

 protect(service:any){

  return {
   protected:true,
   service
  };

 }

}
