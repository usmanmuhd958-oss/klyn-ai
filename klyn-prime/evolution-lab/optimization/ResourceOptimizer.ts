export interface ResourceReport {
  cpu: string;
  memory: string;
  recommendation: string;
}


export class ResourceOptimizer {

  analyze(system: string): ResourceReport {

    return {
      cpu: "optimized",
      memory: "optimized",
      recommendation:
        "Balance performance and cost"
    };

  }

}
