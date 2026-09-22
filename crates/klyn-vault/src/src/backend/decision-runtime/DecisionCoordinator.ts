import {DecisionPolicyEngine} from "./DecisionPolicyEngine.js";
import {DecisionExecutionGraph} from "./DecisionExecutionGraph.js";
import {DecisionMemoryLink} from "./DecisionMemoryLink.js";
import {DecisionFeedbackLoop} from "./DecisionFeedbackLoop.js";


export class DecisionCoordinator {


  private policy =
    new DecisionPolicyEngine();


  private graph =
    new DecisionExecutionGraph();


  private memory =
    new DecisionMemoryLink();


  private feedback =
    new DecisionFeedbackLoop();



  async decide(context:any){

    const decision =
      this.policy.evaluate(context);


    this.graph.add(decision);


    await this.memory.store(decision);


    return this.feedback.analyze(decision);

  }

}
