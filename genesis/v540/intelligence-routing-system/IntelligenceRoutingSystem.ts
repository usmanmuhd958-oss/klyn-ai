export class IntelligenceRoutingSystem {
  route(task: string, layer: string) {
    return {
      task,
      targetLayer: layer
    };
  }
}
