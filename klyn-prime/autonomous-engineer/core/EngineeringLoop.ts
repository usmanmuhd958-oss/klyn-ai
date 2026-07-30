export type EngineeringPhase =
  | "observe"
  | "plan"
  | "build"
  | "test"
  | "improve";


export interface EngineeringCycle {
  task: string;
  phase: EngineeringPhase;
  result?: string;
}


export class EngineeringLoop {

  private history: EngineeringCycle[] = [];


  run(task: string) {

    const phases: EngineeringPhase[] = [
      "observe",
      "plan",
      "build",
      "test",
      "improve"
    ];


    const cycle = phases.map((phase) => {

      const step: EngineeringCycle = {
        task,
        phase,
        result: `${phase} phase completed`
      };

      this.history.push(step);

      return step;
    });


    return cycle;
  }


  getHistory() {
    return this.history;
  }
}
