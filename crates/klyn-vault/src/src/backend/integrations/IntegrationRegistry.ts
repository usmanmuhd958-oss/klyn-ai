export class IntegrationRegistry {

 private integrations:any[] = [];

 register(integration:any){

  this.integrations.push(integration);

  return {
   registered:true,
   integration
  };

 }


 list(){

  return this.integrations;

 }

}
