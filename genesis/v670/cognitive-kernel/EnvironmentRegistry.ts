export class EnvironmentRegistry {

 private environments:string[]=[];

 register(name:string){
   this.environments.push(name);
 }

 list(){
   return this.environments;
 }

}
