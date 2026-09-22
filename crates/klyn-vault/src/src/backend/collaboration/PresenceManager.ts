export class PresenceManager {


 private users:any[]=[];


 join(user:string){

  this.users.push(user);

 }


 list(){

  return this.users;

 }


}
