export class IntelligenceEvaluator {


 evaluate(result:any){

 return {

   quality:
    result ? "high":"low",

   score:
    0.95

 };

 }


}
