export class ProviderRegistry {

 private providers:any[]=[];

 add(provider:any){
  this.providers.push(provider);
  return provider;
 }

 list(){
  return this.providers;
 }

}
