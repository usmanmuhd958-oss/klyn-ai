export interface ArchitectureSuggestion {
  area: string;
  suggestion: string;
  impact: string;
}


export class ArchitectureOptimizer {

  optimize(system: string): ArchitectureSuggestion {

    return {
      area: system,
      suggestion: "Improve modular architecture",
      impact: "higher maintainability"
    };

  }

}
