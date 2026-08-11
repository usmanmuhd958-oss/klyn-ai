export class IntelligenceLayerIntegrationController {
  integrate(layers:any[]){
    return {
      layers,
      integration:"completed"
    };
  }
}
