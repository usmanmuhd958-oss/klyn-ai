export class IntelligenceRegistry {


 private intelligence:any[]=[];


 add(layer:any){

   this.intelligence.push(layer);

 }


 get(){

   return this.intelligence;

 }


}
