export interface BrainRequest {
  goal: string;
  context?: unknown;
}

export interface BrainResponse {
  decision: string;
  confidence: number;
}

export class PrimeBrain {

  private modules:any[] = [];

  register(module:any){
    this.modules.push(module);
  }


  async think(request:BrainRequest):Promise<BrainResponse>{

    const results = [];

    for(const module of this.modules){

      if(module.process){
        results.push(
          await module.process(request)
        );
      }

    }


    return {

      decision:
        results.join("\n"),

      confidence:
        results.length > 0 ? 0.9 : 0.1

    };

  }

}
