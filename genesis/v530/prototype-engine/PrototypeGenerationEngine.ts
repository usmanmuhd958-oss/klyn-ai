export class PrototypeGenerationEngine {
  generate(spec: unknown) {
    return {
      prototype: spec,
      mode: "experimental"
    };
  }
}
