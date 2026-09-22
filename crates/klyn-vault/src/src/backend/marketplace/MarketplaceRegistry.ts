export class MarketplaceRegistry {

 private items:any[]=[];


 register(item:any){

  this.items.push(item);

  return {
   registered:true,
   item
  };

 }


 list(){

  return this.items;

 }

}
