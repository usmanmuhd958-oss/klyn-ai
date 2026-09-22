import { AIModel } from "./AIModel.js";


export class ModelRegistry {

 private models:AIModel[]=[];


 register(model:AIModel){

  this.models.push(model);

 }


 list(){

  return this.models;

 }


}
