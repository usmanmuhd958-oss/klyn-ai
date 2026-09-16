import { AutonomousSystemFusion } from "./AutonomousSystemFusion";

export class SystemFusionController {
  private fusion = new AutonomousSystemFusion();

  boot() {
    return this.fusion.initialize();
  }
}
