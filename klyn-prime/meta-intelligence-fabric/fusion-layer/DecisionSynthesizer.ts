/**
 * KLYN Prime Decision Synthesizer
 *
 * Converts intelligence signals, knowledge,
 * reasoning outputs and objectives into
 * executable decisions.
 */


export interface DecisionInput {

    source:string;

    objective:string;

    reasoning:any;

    confidence:number;

    priority:number;

}



export interface DecisionOutput {

    action:string;

    rationale:string;

    confidence:number;

    priority:number;

    timestamp:number;

}




export class DecisionSynthesizer {


    private decisions:
    DecisionInput[];



    constructor(){

        this.decisions=[];

    }




    submit(
        input:DecisionInput
    ):void {


        this.decisions.push(input);

    }





    synthesize():
    DecisionOutput {


        if(
            this.decisions.length===0
        ){

            return {

                action:"none",

                rationale:
                "No intelligence input available",

                confidence:0,

                priority:0,

                timestamp:
                Date.now()

            };

        }




        const ranked =
        [...this.decisions]
        .sort(

            (a,b)=>

            (
                b.confidence *
                b.priority

            )

            -

            (
                a.confidence *
                a.priority
            )

        );



        const best =
        ranked[0];



        return {


            action:
            this.generateAction(best),


            rationale:
            this.generateReason(best),


            confidence:
            best.confidence,


            priority:
            best.priority,


            timestamp:
            Date.now()


        };


    }





    private generateAction(
        input:DecisionInput
    ):string {


        return `Execute objective: ${input.objective}`;

    }





    private generateReason(
        input:DecisionInput
    ):string {


        return `Decision selected from ${input.source} with confidence ${input.confidence}`;

    }





    clear():void {

        this.decisions=[];

    }





    size():number {

        return this.decisions.length;

    }


}
