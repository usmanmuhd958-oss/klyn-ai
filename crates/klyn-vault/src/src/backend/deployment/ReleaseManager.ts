export class ReleaseManager {


 private releases:string[]=[];


 create(version:string){

  this.releases.push(version);


  return {

   released:true,

   version

  };


 }


 history(){

  return this.releases;

 }


}
