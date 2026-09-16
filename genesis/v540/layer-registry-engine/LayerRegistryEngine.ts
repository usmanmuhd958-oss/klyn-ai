export class LayerRegistryEngine {
  register(layer: string) {
    return {
      layer,
      registered: true
    };
  }
}
