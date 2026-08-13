export class ProjectMap {

 private files:string[]=[];


 add(file:string){

  this.files.push(file);

 }


 get(){

  return this.files;

 }

}
