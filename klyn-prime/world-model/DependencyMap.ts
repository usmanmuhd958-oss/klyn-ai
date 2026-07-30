export class DependencyMap {


private dependencies =
new Map<string,string[]>();


add(
module:string,
dependsOn:string[]
){

 this.dependencies.set(
   module,
   dependsOn
 );

}


get(module:string){

 return this.dependencies.get(module) || [];

}


all(){

 return this.dependencies;

}


}
