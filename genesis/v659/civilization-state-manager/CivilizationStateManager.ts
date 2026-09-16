export class CivilizationStateManager {

  private layer = "V659";

  initialize() {
    return {
      system: "CivilizationStateManager",
      civilizationLayer: this.layer,
      status: "active"
    };
  }

}
