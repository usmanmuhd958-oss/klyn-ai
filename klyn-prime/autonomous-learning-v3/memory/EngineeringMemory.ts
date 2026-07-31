/**
 * KLYN Prime Autonomous Learning Engine v3
 *
 * Engineering experience intelligence foundation.
 */


export type ExperienceOutcome =
    | "success"
    | "failure"
    | "improved";



export interface EngineeringExperience {

    id:string;

    agentId:string;

    task:string;

    solution:string;

    outcome:ExperienceOutcome;

    impact:number;

    lessons:string[];

    timestamp:number;

}



export interface Strategy {

    id:string;

    name:string;

    usage:number;

    successRate:number;

}







export class EngineeringMemory {


    private experiences:
        EngineeringExperience[];


    private strategies:
        Strategy[];




    constructor(){

        this.experiences=[];

        this.strategies=[];


        console.log(
            "[KLYN ENGINEERING MEMORY v3] Online"
        );

    }







    storeExperience(
        experience:EngineeringExperience
    ){

        this.experiences.push(
            experience
        );


        return experience;

    }







    registerStrategy(
        strategy:Strategy
    ){

        this.strategies.push(
            strategy
        );


        return strategy;

    }







    findSimilarTasks(
        keyword:string
    ){

        return this.experiences.filter(

            item =>

            item.task
            .toLowerCase()
            .includes(
                keyword.toLowerCase()
            )

        );

    }







    evaluateLearning(){

        const total =
            this.experiences.length;


        const successful =
            this.experiences.filter(

                item =>
                item.outcome === "success"

            ).length;



        return {

            totalExperiences:
            total,


            successRate:
            total === 0
            ?
            0
            :
            successful / total


        };

    }







    recommendStrategy(){

        return this.strategies.sort(

            (a,b)=>

            b.successRate -
            a.successRate

        );

    }







    snapshot(){

        return {

            experiences:
            this.experiences,


            strategies:
            this.strategies,


            createdAt:
            Date.now()

        };

    }



}
