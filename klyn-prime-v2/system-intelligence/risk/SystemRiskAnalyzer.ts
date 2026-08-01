export interface RiskReport {

 severity:string;

 risks:string[];

}


export class SystemRiskAnalyzer {


 scan(system:any):RiskReport {


   return {

     severity:"unknown",

     risks:[]

   };


 }


}
