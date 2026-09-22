export class PermissionManager {


 private permissions = new Map();


 grant(
  role:string,
  permission:string
 ){

  this.permissions.set(
   role,
   permission
  );


 }


 check(role:string){

  return this.permissions.get(role);

 }


}
