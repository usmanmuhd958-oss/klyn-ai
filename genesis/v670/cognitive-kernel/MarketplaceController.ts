import {AgentMarketplace} from "./AgentMarketplace";

export class MarketplaceController {

  boot(){

    const market=new AgentMarketplace();

    return {
      layer:"V722",
      system:"Agent Marketplace Fabric",
      status:"online",
      marketplace:market
    };

  }

}
