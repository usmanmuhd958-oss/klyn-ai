export class PermissionEngine {

 check(action:string){

   return {
     action,
     permission:"granted"
   };

 }

}
