import {EngineeringPlanner} from "./EngineeringPlanner.js";
import {CodeGenerationAgent} from "./CodeGenerationAgent.js";
import {TestGenerationAgent} from "./TestGenerationAgent.js";
import {CodeReviewAgent} from "./CodeReviewAgent.js";
import {RepairAgent} from "./RepairAgent.js";
import {EngineeringMemoryBridge} from "./EngineeringMemoryBridge.js";


export class EngineeringLoopController {

  planner=new EngineeringPlanner();
  generator=new CodeGenerationAgent();
  tester=new TestGenerationAgent();
  reviewer=new CodeReviewAgent();
  repairer=new RepairAgent();
  memory=new EngineeringMemoryBridge();


  execute(task:any){

    const plan=this.planner.plan(task);

    const code=this.generator.generate(plan);

    const tests=this.tester.generate(code);

    const review=this.reviewer.review(code);

    this.memory.remember(review);

    return {
      plan,
      code,
      tests,
      review
    };

  }

}
