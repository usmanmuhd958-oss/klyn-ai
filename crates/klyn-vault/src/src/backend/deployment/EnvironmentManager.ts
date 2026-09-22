export class EnvironmentManager {


 private environment = "development";


 setEnvironment(name:string){

  this.environment = name;

 }


 current(){

  return this.environment;

 }


}
