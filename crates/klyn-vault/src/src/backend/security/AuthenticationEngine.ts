export class AuthenticationEngine {


 authenticate(identity:any){

  return {

   authenticated:true,

   identity

  };

 }


}
