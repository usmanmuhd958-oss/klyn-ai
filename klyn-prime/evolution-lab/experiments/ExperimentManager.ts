export interface Experiment {
  id: string;
  objective: string;
  status: "created" | "running" | "completed";
}


export class ExperimentManager {

  private experiments: Experiment[] = [];


  create(objective: string) {

    const experiment = {
      id: crypto.randomUUID(),
      objective,
      status: "created" as const
    };

    this.experiments.push(experiment);

    return experiment;
  }


  list() {
    return this.experiments;
  }

}
