export class GlobalStateController {

  private layer = "V668";

  initialize() {
    return {
      system: "GlobalStateController",
      civilizationLayer: this.layer,
      status: "active"
    };
  }

}
