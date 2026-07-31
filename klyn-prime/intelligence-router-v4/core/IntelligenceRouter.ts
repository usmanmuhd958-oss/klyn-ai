/**
 * KLYN Prime Global Intelligence Router v4
 *
 * Multi-model intelligence selection foundation.
 */


export type ModelCapability =
    | "coding"
    | "reasoning"
    | "analysis"
    | "research"
    | "fast-response";



export interface IntelligenceModel {

    id:string;

    provider:string;

    name:string;

    capabilities:ModelCapability[];

    qualityScore:number;

    latency:number;

    costScore:number;

    available:boolean;

}



export interface RoutingDecision {

    task:string;

    selectedModel:string;

    reason:string;

    confidence:number;

}







export class IntelligenceRouter {


    private models:
        IntelligenceModel[];




    constructor(){

        this.models=[];


        console.log(
            "[KLYN GLOBAL INTELLIGENCE ROUTER v4] Online"
        );

    }







    registerModel(
        model:IntelligenceModel
    ){

        this.models.push(
            model
        );


        return model;

    }







    findModels(
        capability:ModelCapability
    ){

        return this.models.filter(

            model =>

            model.available
            &&
            model.capabilities.includes(
                capability
            )

        );

    }







    route(
        task:string,
        capability:ModelCapability
    ):RoutingDecision{


        const candidates =
            this.findModels(
                capability
            );



        const ranked =
            candidates.sort(

                (a,b)=>

                (
                    b.qualityScore -
                    b.costScore
                )
                -
                (
                    a.qualityScore -
                    a.costScore
                )

            );



        const selected =
            ranked[0];



        return {


            task,


            selectedModel:
            selected?.name
            ??
            "fallback-engine",


            reason:
            selected
            ?
            "Best capability and performance match"
            :
            "No available model",


            confidence:
            selected
            ?
            selected.qualityScore
            :
            0


        };

    }







    health(){

        return {

            totalModels:
            this.models.length,


            activeModels:
            this.models.filter(

                item =>
                item.available

            ).length,


            timestamp:
            Date.now()

        };

    }



}
