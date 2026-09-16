import { EvolutionAnalyzer } from "./EvolutionAnalyzer.js";
import { SystemObservation } from "./types/evolution.types.js";


export class EvolutionController {

private analyzer = new EvolutionAnalyzer();


evaluate(
 observation:SystemObservation
){

return {
  observation,
  proposals:this.analyzer.analyze(observation)
};

}


}

