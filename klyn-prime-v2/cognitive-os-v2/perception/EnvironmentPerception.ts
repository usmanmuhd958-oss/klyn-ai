export interface EnvironmentSnapshot {
  timestamp: number;
  projectState: Record<string, unknown>;
  signals: string[];
  risks: string[];
}


export class EnvironmentPerception {

  private history: EnvironmentSnapshot[] = [];


  scan(environment: Record<string, unknown>): EnvironmentSnapshot {

    const signals: string[] = [];
    const risks: string[] = [];


    if (environment["git"]) {
      signals.push("Repository detected");
    }


    if (environment["tests"] === false) {
      risks.push("Testing coverage missing");
    }


    const snapshot: EnvironmentSnapshot = {
      timestamp: Date.now(),
      projectState: environment,
      signals,
      risks
    };


    this.history.push(snapshot);


    return snapshot;
  }



  observeHistory() {
    return this.history;
  }
}
