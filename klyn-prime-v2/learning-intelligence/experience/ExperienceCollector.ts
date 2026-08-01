export interface Experience {

 task:string;

 result:any;

 timestamp:number;

}


export class ExperienceCollector {


 private experiences:Experience[]=[];


 record(exp:Experience){

   this.experiences.push(exp);

 }


 getAll(){

   return this.experiences;

 }


}
