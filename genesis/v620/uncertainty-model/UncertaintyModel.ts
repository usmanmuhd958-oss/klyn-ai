export class UncertaintyModel {

  analyze(input: unknown) {
    return {
      layer: "UncertaintyModel",
      status: "active",
      input
    };
  }

}
