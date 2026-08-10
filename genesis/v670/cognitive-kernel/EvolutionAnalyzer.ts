import { EvolutionObservation }
from "./EvolutionObservation";


export class EvolutionAnalyzer {


 analyze(
  observation:EvolutionObservation
 ){

  return {

   observation,

   findings:[
    "analyze-performance",
    "detect-pattern",
    "suggest-improvement"
   ],

   confidence:0.5

  };

 }

}
