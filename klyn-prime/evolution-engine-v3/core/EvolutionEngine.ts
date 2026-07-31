/**
 * KLYN Prime Evolution Engine v3
 *
 * Controlled self-improvement foundation.
 */


export type ExperimentStatus =
    | "created"
    | "running"
    | "approved"
    | "rejected";



export interface Capability {

    id:string;

    name:string;

    performance:number;

    priority:number;

}




export interface EvolutionExperiment {

    id:string;

    target:string;

    hypothesis:string;

    improvement:number;

    status:ExperimentStatus;

    createdAt:number;

}







export class EvolutionEngine {


    private capabilities:
        Capability[];


    private experiments:
        EvolutionExperiment[];




    constructor(){

        this.capabilities=[];

        this.experiments=[];


        console.log(
            "[KLYN EVOLUTION ENGINE v3] Online"
        );

    }







    registerCapability(
        capability:Capability
    ){

        this.capabilities.push(
            capability
        );


        return capability;

    }







    createExperiment(
        target:string,
        hypothesis:string
    ){


        const experiment:
        EvolutionExperiment = {


            id:
            crypto.randomUUID(),


            target,


            hypothesis,


            improvement:0,


            status:
            "created",


            createdAt:
            Date.now()


        };


        this.experiments.push(
            experiment
        );


        return experiment;

    }







    runExperiment(
        id:string,
        measuredImprovement:number
    ){


        const experiment =
            this.experiments.find(

                item =>
                item.id === id

            );


        if(!experiment)
            return null;



        experiment.improvement =
            measuredImprovement;



        experiment.status =
            measuredImprovement > 0
            ?
            "approved"
            :
            "rejected";



        return experiment;

    }







    optimizeCapabilities(){

        return this.capabilities.sort(

            (a,b)=>
            b.performance -
            a.performance

        );

    }







    systemEvolutionReport(){

        return {

            capabilities:
            this.capabilities,


            experiments:
            this.experiments,


            generatedAt:
            Date.now()

        };

    }



}
