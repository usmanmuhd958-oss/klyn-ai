export interface ExperienceRecord {
  task: string;
  result: string;
  score: number;
  timestamp: number;
}


export interface LearningInsight {
  pattern: string;
  improvement: string;
  confidence: number;
}


export class ContinuousLearningEngine {

  private experiences: ExperienceRecord[] = [];


  learn(
    experience: ExperienceRecord
  ): LearningInsight {

    this.experiences.push(experience);


    return {

      pattern:
        `Observed pattern from task: ${experience.task}`,

      improvement:
        experience.score >= 0.8
          ? "Maintain successful strategy"
          : "Search for better strategy",

      confidence:
        experience.score

    };

  }


  getExperiences() {
    return this.experiences;
  }

}
