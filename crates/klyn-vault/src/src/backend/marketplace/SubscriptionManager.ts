export class SubscriptionManager {

 subscribe(user:string, plan:string){

  return {
   user,
   plan,
   active:true
  };

 }

}
