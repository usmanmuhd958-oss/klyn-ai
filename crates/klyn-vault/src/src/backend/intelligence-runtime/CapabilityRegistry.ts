export class CapabilityRegistry {


 private capabilities:any[]=[];


 register(capability:any){

   this.capabilities.push(capability);

 }


 list(){

   return this.capabilities;

 }


}
