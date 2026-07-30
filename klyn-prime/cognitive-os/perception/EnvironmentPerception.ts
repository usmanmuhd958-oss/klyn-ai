export class EnvironmentPerception {


    analyze(input:any){

        return {

            type:typeof input,

            signals:[
                "context",
                "intent",
                "risk"
            ],

            timestamp:
            Date.now()

        };

    }


}
