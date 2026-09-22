export class WebhookManager {

 register(url:string){

  return {
   webhook:url,
   active:true
  };

 }

}
