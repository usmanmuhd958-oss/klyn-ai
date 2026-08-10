export class GenesisIntelligenceInitializer {

  create(seed:any){
    return {
      status:"genesis_seed_created",
      seed
    };
  }

}
