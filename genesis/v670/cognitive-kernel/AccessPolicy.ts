export class AccessPolicy {

 check(permission:string){

   return {
    permission,
    allowed:true
   };

 }

}
