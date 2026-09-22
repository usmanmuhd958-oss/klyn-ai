export class AuthorizationEngine {


 authorize(
  user:any,
  action:string
 ){

  return {

   allowed:true,

   user,

   action

  };


 }


}
