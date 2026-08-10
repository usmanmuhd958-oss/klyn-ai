import { AutonomousControlPlane } from "./AutonomousControlPlane";

export class ControlPlaneRuntime {

  start() {
    return new AutonomousControlPlane().boot();
  }

}
