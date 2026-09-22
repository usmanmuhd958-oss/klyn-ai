export class ExperienceRepository {

  private experiences:any[]=[];


  save(experience:any){

    this.experiences.push(experience);

  }


  getAll(){

    return this.experiences;

  }

}
