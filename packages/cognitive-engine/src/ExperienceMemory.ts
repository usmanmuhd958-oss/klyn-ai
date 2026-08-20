export interface Experience {
  id: string;

  situation: string;

  action: string;

  reasoning: string;

  result: string;

  success: boolean;

  confidence: number;

  timestamp: Date;
}


export class ExperienceMemory {
  private experiences: Experience[] = [];


  addExperience(
    experience: Experience
  ): void {

    this.experiences.push(experience);
  }


  getExperiences(): Experience[] {

    return this.experiences;
  }


  findSimilar(
    situation: string
  ): Experience[] {

    return this.experiences.filter(
      exp =>
        exp.situation
          .toLowerCase()
          .includes(
            situation.toLowerCase()
          )
    );
  }


  getSuccessPatterns(): Experience[] {

    return this.experiences.filter(
      exp => exp.success
    );
  }


  clear(): void {

    this.experiences = [];
  }
}
