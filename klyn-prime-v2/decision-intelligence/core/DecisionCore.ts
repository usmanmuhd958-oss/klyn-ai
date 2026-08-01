export interface Decision {

    action:string;

    confidence:number;

    reason:string;

}


export class DecisionCore {


    decide(options:string[]):Decision {

        return {

            action: options[0] ?? "none",

            confidence: 0,

            reason:"Decision requires evaluation"

        };

    }


}
