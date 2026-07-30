export class PerceptionEngine {


    analyze(input:any){

        return {

            type: typeof input,

            signals:[
                "input-detected"
            ],

            raw:input

        };

    }


}
