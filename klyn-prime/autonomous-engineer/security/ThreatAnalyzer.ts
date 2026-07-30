export interface ThreatReport {
  threats: string[];
  severity: number;
}


export class ThreatAnalyzer {

  analyze(system: string): ThreatReport {

    return {
      threats: [],
      severity: 0
    };

  }

}
