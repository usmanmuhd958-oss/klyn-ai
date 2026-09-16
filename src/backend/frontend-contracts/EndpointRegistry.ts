export class EndpointRegistry {


 endpoints=[

   "/workspace",

   "/agents",

   "/projects",

   "/intelligence"

 ];



 list(){

   return this.endpoints;

 }


}
