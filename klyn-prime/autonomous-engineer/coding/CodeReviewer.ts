export interface ReviewResult {
  score: number;
  issues: string[];
}


export class CodeReviewer {

  review(code: string): ReviewResult {

    return {
      score: 100,
      issues: []
    };

  }

}
