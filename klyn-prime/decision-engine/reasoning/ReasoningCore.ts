import { Observation } from "../observation/ObservationEngine";


export interface ReasoningResult {

    decision:string;
    confidence:number;

}


export class ReasoningCore {


    analyze(
        observation:Observation
    ):ReasoningResult {


        return {

            decision:
            `Analyze ${observation.source}`,

            confidence:0.5

        };

    }

}
