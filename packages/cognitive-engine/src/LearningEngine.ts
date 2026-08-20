import { ExperienceMemory } from "./ExperienceMemory";


export interface LearnedPattern {
  id: string;

  pattern: string;

  confidence: number;

  occurrences: number;
}


export class LearningEngine {

  private patterns: LearnedPattern[] = [];


  constructor(
    private memory: ExperienceMemory
  ) {}


  learn(): LearnedPattern[] {

    const experiences =
      this.memory.getSuccessPatterns();


    const patternMap =
      new Map<string, number>();


    for (const exp of experiences) {

      const key = exp.action;


      patternMap.set(
        key,
        (patternMap.get(key) || 0) + 1
      );
    }


    this.patterns =
      Array.from(patternMap.entries())
      .map(([pattern, occurrences]) => ({
        id: crypto.randomUUID(),

        pattern,

        occurrences,

        confidence:
          Math.min(
            occurrences / 10,
            1
          )
      }));


    return this.patterns;
  }


  getPatterns(): LearnedPattern[] {

    return this.patterns;
  }
}
