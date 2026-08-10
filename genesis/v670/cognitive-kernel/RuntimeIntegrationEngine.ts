export class RuntimeIntegrationEngine {
  integrate(modules: any[]) {
    return {
      integrated: true,
      modules
    };
  }
}
