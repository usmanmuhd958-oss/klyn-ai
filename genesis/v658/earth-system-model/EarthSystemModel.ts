export class EarthSystemModel {

  private layer = "V658";

  initialize() {
    return {
      system: "EarthSystemModel",
      civilizationLayer: this.layer,
      status: "active"
    };
  }

}
