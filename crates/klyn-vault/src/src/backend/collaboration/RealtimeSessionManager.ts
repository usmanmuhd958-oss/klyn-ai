export class RealtimeSessionManager {

 private sessions = new Map<string, any>();

 create(id:string){

  this.sessions.set(id,{
   id,
   createdAt:Date.now()
  });

  return this.sessions.get(id);

 }


 get(id:string){

  return this.sessions.get(id);

 }

}
