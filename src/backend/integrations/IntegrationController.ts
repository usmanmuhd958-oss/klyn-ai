import { IntegrationRegistry } from "./IntegrationRegistry.js";
import { ConnectorManager } from "./ConnectorManager.js";


export class IntegrationController {

 registry =
  new IntegrationRegistry();


 connector =
  new ConnectorManager();


 addIntegration(service:string){

  this.registry.register(service);

  return this.connector.connect(service);

 }

}
