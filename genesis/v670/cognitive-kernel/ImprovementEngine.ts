import { EvolutionAnalyzer }
from "./EvolutionAnalyzer";


export class ImprovementEngine {

 private analyzer =
  new EvolutionAnalyzer();


 improve(data:any){

   const analysis =
    this.analyzer.analyze(data);


   return {

    analysis,

    proposal:
    "optimize-next-cycle"

   };

 }

}
