import { ReasoningEngine } from "./ReasoningEngine";
import { PlanningEngine } from "./PlanningEngine";
import { VerificationEngine } from "./VerificationEngine";

export class CognitiveController {

  private reasoning = new ReasoningEngine();
  private planning = new PlanningEngine();
  private verification = new VerificationEngine();


  execute(task:any){

    const reasoning =
      this.reasoning.analyze(task);

    const plan =
      this.planning.createPlan(task);

    const verification =
      this.verification.verify(plan);


    return {
      reasoning,
      plan,
      verification,
      status:"complete"
    };

  }

}
