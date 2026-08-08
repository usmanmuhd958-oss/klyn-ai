export class PhysicalWorldModel {

  private layer = "V664";

  initialize() {
    return {
      system: "PhysicalWorldModel",
      civilizationLayer: this.layer,
      status: "active"
    };
  }

}
