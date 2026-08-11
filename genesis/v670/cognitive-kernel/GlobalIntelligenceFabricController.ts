export class GlobalIntelligenceFabricController {
  connect(network:any[]){
    return {
      network,
      fabric:"connected"
    };
  }
}
