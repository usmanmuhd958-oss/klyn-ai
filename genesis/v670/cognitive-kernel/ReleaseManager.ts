export class ReleaseManager {

 private releases:string[]=[];

 create(version:string){

   this.releases.push(version);

 }

 list(){
   return this.releases;
 }

}
