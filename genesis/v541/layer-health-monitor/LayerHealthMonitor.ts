export class LayerHealthMonitor {
  check(layer: string) {
    return {
      layer,
      healthy: true
    };
  }
}
