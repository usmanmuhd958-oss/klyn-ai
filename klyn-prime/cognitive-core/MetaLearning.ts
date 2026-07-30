export interface LearningPattern {
  source: string;
  lesson: string;
  capability: string;
}

export class MetaLearning {
  private patterns: LearningPattern[] = [];

  learn(pattern: LearningPattern) {
    this.patterns.push(pattern);
  }

  extractCapabilities() {
    return this.patterns.map(
      pattern => pattern.capability
    );
  }

  knowledgeBase() {
    return this.patterns;
  }
}
