import { SystemObservation, EvolutionProposal } from "./types/evolution.types.js";


export class EvolutionAnalyzer {

  analyze(
    observation:SystemObservation
  ): EvolutionProposal[] {

    const proposals:EvolutionProposal[]=[];


    for(const [key,value] of Object.entries(observation.checks)){

      if(value !== "healthy" &&
         value !== "active" &&
         value !== "loaded"){

        proposals.push({
          id: crypto.randomUUID(),
          issue:key,
          action:`Investigate ${key}`,
          risk:"low"
        });

      }

    }


    return proposals;

  }

}

