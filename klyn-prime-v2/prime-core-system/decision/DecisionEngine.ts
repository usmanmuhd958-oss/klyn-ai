export interface Decision {

    action:string;

    reason:string;

    confidence:number;

}


export class DecisionEngine {


    decide(context:any):Decision{


        if(!context){

            return {

                action:"request_context",

                reason:"Missing system context",

                confidence:0.1

            };

        }


        return {

            action:"analyze_and_execute",

            reason:
            "Context available for autonomous processing",

            confidence:0.8

        };

    }


}
