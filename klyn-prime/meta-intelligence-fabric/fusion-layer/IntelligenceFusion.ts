/**
 * KLYN Prime Intelligence Fusion Layer
 *
 * Connects multiple intelligence subsystems
 * into a unified reasoning pipeline.
 */


export interface IntelligenceSignal {

    source:string;

    type:string;

    data:any;

    confidence:number;

}



export interface FusionResult {

    unifiedContext:any;

    dominantSignal:string;

    intelligenceScore:number;

}



export class IntelligenceFusion {


    private signals:
        IntelligenceSignal[];



    constructor(){

        this.signals = [];

    }




    registerSignal(
        signal:IntelligenceSignal
    ){

        this.signals.push(signal);

    }




    fuse():
    FusionResult {


        if(this.signals.length===0){

            return {

                unifiedContext:{},

                dominantSignal:"none",

                intelligenceScore:0

            };

        }



        const sorted =
            [...this.signals]
            .sort(
                (a,b)=>
                b.confidence-a.confidence
            );



        const dominant =
            sorted[0];



        const score =
            this.calculateScore(
                sorted
            );



        return {


            unifiedContext:{

                signals:
                sorted

            },


            dominantSignal:
            dominant.source,


            intelligenceScore:
            score


        };


    }





    private calculateScore(
        signals:IntelligenceSignal[]
    ):number {


        const total =
            signals.reduce(

                (sum,item)=>
                sum + item.confidence,

                0

            );


        return Math.min(

            100,

            total /
            signals.length *
            100

        );


    }



}
