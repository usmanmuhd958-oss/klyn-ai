export class IntentRouter {

  route(input:any){

    return {
      type:"processed",
      intent:"processed",
      input
    };

  }


 analyze(input:string){

   return {
     intent:"unknown",
     input
   };

 }

}
