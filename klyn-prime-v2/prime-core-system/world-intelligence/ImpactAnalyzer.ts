export class ImpactAnalyzer {


    analyze(change:any){

        return {

            change,

            risks:[],

            effects:[],

            confidence:0

        };

    }


}
