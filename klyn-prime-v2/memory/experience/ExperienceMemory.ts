export interface Experience {

 id:string;

 task:string;

 action:string;

 result:string;

 lesson:string;

 timestamp:number;

}


export class ExperienceMemory {


 private experiences:Experience[]=[];


 record(exp:Experience){

   this.experiences.push(exp);

 }


 learn(){

   return this.experiences.map(
     e => e.lesson
   );

 }


 getAll(){

   return this.experiences;

 }


}
