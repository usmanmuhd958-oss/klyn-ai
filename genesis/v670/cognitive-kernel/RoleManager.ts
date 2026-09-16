export class RoleManager {

 private roles = new Map<string,string[]>();

 assign(user:string, role:string){
   this.roles.set(
    user,
    [...(this.roles.get(user)||[]),role]
   );
 }

 getRoles(user:string){
   return this.roles.get(user)||[];
 }

}
