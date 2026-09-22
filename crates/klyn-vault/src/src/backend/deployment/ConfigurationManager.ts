export class ConfigurationManager {


 private config =
  new Map<string,unknown>();


 set(
  key:string,
  value:unknown
 ){

  this.config.set(key,value);

 }


 get(key:string){

  return this.config.get(key);

 }


}
