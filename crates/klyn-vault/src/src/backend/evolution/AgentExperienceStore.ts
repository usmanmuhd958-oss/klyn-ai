export class AgentExperienceStore {

 private experiences:any[] = [];

 record(experience:any){

  this.experiences.push({
   ...experience,
   timestamp:Date.now()
  });

 }

 getAll(){

  return this.experiences;

 }

}
