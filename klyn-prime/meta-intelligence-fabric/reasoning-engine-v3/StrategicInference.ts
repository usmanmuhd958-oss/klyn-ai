/**
 * KLYN Prime Strategic Inference Engine v3
 *
 * Converts reasoning outputs into strategic decisions.
 */


export interface StrategicInput {

    objective:string;

    constraints:string[];

    availableActions:string[];

}



export interface StrategicDecision {

    objective:string;

    selectedAction:string;

    reasoning:string[];

    confidence:number;

}



export class StrategicInference {


    infer(
        input:StrategicInput
    ):StrategicDecision {


        const ranked =
            this.rankActions(
                input.availableActions,
                input.constraints
            );


        const selected =
            ranked[0];



        return {


            objective:
            input.objective,


            selectedAction:
            selected,


            reasoning:[

                "Analyzed objective",

                "Evaluated constraints",

                "Ranked possible actions",

                "Selected highest utility path"

            ],


            confidence:
            0.85


        };


    }




    private rankActions(
        actions:string[],
        constraints:string[]
    ):string[] {


        return actions.sort(
            (a,b)=>
            this.utilityScore(
                b,
                constraints
            )
            -
            this.utilityScore(
                a,
                constraints
            )
        );


    }




    private utilityScore(
        action:string,
        constraints:string[]
    ):number {


        let score = 50;


        for(
            const constraint of constraints
        ){

            if(
                action
                .toLowerCase()
                .includes(
                    constraint.toLowerCase()
                )
            ){

                score -= 20;

            }

        }


        return score;

    }



}
