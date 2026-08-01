export class ContextAnalyzer {


    analyze(observation:any){


        return {

            understanding:
            "context analyzed",

            source:
            observation.source,

            timestamp:
            Date.now()

        };

    }


}
