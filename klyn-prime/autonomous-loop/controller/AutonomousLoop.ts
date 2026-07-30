export class AutonomousLoop {

  constructor(
    private observer:any,
    private reasoner:any,
    private planner:any,
    private executor:any,
    private feedback:any
  ) {}

  async run(goal:string){

    const observation =
      await this.observer.observe();

    const strategy =
      await this.reasoner.analyze(
        observation,
        goal
      );

    const plan =
      await this.planner.create(strategy);

    const result =
      await this.executor.execute(plan);

    await this.feedback.evaluate(result);

    return result;
  }
}
