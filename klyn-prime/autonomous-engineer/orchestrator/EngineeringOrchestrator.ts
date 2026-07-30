import { EngineeringLoop } from "../core/EngineeringLoop";
import { ArchitecturePlanner } from "../planning/ArchitecturePlanner";
import { CodeGenerator } from "../coding/CodeGenerator";
import { TestIntelligence } from "../testing/TestIntelligence";
import { VulnerabilityScanner } from "../security/VulnerabilityScanner";


export class EngineeringOrchestrator {

  private loop = new EngineeringLoop();
  private architecture = new ArchitecturePlanner();
  private coder = new CodeGenerator();
  private tester = new TestIntelligence();
  private security = new VulnerabilityScanner();


  execute(goal: string) {

    const plan =
      this.loop.run(goal);


    const architecture =
      this.architecture.analyze(
        goal,
        "autonomous system component"
      );


    const code =
      this.coder.generate(
        "typescript",
        goal
      );


    const tests =
      this.tester.analyze(
        JSON.stringify(code)
      );


    const security =
      this.security.scan(
        JSON.stringify(code)
      );


    return {
      plan,
      architecture,
      code,
      tests,
      security
    };

  }

}
