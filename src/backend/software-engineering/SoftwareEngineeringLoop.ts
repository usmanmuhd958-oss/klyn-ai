import { EngineeringPlanner } from "./EngineeringPlanner.js";
import { CodeGenerationEngine } from "./CodeGenerationEngine.js";
import { TestGenerationEngine } from "./TestGenerationEngine.js";


export class SoftwareEngineeringLoop {

 planner =
  new EngineeringPlanner();

 generator =
  new CodeGenerationEngine();

 tester =
  new TestGenerationEngine();


 execute(goal:string){

  const plan =
   this.planner.plan(goal);


  return {

   plan,

   code:
    this.generator.generate(goal),

   tests:
    this.tester.generateTests(goal)

  };

 }

}
