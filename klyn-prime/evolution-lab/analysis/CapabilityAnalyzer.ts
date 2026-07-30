export interface CapabilityReport {
  capability: string;
  score: number;
  missingFeatures: string[];
}


export class CapabilityAnalyzer {

  analyze(system: string): CapabilityReport {

    return {
      capability: system,
      score: 0,
      missingFeatures: []
    };

  }

}
