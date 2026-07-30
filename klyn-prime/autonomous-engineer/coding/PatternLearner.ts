export interface CodePattern {
  name: string;
  usage: string;
}


export class PatternLearner {

  private patterns: CodePattern[] = [];


  learn(pattern: CodePattern) {
    this.patterns.push(pattern);
  }


  getPatterns() {
    return this.patterns;
  }

}
