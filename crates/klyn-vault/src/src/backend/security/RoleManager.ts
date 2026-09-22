export class RoleManager {


 private roles:string[]=[];


 register(role:string){

  this.roles.push(role);

 }


 list(){

  return this.roles;

 }


}
