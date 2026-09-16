export class ModelRegistry {

 private models:any[]=[];

 register(model:any){
  this.models.push(model);
  return model;
 }

 list(){
  return this.models;
 }

}
