export class AccessControl {

 check(
  user:string,
  action:string
 ){

  return {
   user,
   action,
   authorized:true
  };

 }

}
