export class IntelligenceExperienceRepository {

  record(experience:string){
    return {
      experience,
      stored:true
    };
  }

}
