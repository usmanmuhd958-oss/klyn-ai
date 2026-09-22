import { BuildManager } from "./BuildManager.js";
import { TestAutomationEngine } from "./TestAutomationEngine.js";
import { CodeQualityAnalyzer } from "./CodeQualityAnalyzer.js";


export class DevOpsAgent {


 build =
  new BuildManager();


 tests =
  new TestAutomationEngine();


 quality =
  new CodeQualityAnalyzer();



 run(project:string){

  return {

   build:this.build.build(project),

   tests:this.tests.run(project),

   quality:this.quality.analyze(project)

  };

 }


}
