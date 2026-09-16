export class RuntimeCompositionEngine {
  compose(modules: any[]) {
    return {
      modules,
      composed: true
    };
  }
}
