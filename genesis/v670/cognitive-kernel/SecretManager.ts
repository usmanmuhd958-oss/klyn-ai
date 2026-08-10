export class SecretManager {

 private secrets = new Map<string,string>();

 store(key:string,value:string){
   this.secrets.set(key,value);
 }

 exists(key:string){
   return this.secrets.has(key);
 }

}
