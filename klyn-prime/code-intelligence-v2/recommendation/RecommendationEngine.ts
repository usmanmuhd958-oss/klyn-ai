/**
 * KLYN Prime Code Intelligence v2
 *
 * Recommendation Engine
 *
 * Converts code intelligence signals
 * into engineering improvement actions.
 */


export type RecommendationPriority =
    | "critical"
    | "high"
    | "medium"
    | "low";


export interface Recommendation {

    id:string;

    category:
        | "architecture"
        | "performance"
        | "security"
        | "quality"
        | "maintainability";


    title:string;

    explanation:string;

    priority:RecommendationPriority;

    confidence:number;

    createdAt:number;

}




export interface IntelligenceContext {

    fileCount:number;

    issueCount:number;

    architectureScore:number;

    memoryMatches:number;

}




export class RecommendationEngine {


    private recommendations:
        Recommendation[];



    constructor(){

        this.recommendations=[];

    }




    generate(
        context:IntelligenceContext
    ):Recommendation[] {


        const results:
            Recommendation[] = [];



        if(
            context.issueCount > 10
        ){

            results.push(

                this.create(

                    "quality",

                    "Reduce technical debt",

                    "Many issues detected. Refactor unstable areas first.",

                    "high",

                    0.85

                )

            );

        }





        if(
            context.architectureScore < 70
        ){

            results.push(

                this.create(

                    "architecture",

                    "Improve module boundaries",

                    "System structure needs clearer separation.",

                    "high",

                    0.82

                )

            );

        }





        if(
            context.memoryMatches > 0
        ){

            results.push(

                this.create(

                    "optimization",

                    "Apply previous engineering knowledge",

                    "Similar patterns were solved before.",

                    "medium",

                    0.75

                )

            );

        }





        if(
            context.fileCount > 1000
        ){

            results.push(

                this.create(

                    "maintainability",

                    "Introduce stronger project indexing",

                    "Large codebases require intelligent navigation.",

                    "medium",

                    0.8

                )

            );

        }




        this.recommendations.push(
            ...results
        );


        return results;

    }





    private create(

        category:
        Recommendation["category"],

        title:string,

        explanation:string,

        priority:
        RecommendationPriority,

        confidence:number

    ):Recommendation {



        return {


            id:
                crypto.randomUUID(),


            category,


            title,


            explanation,


            priority,


            confidence,


            createdAt:
                Date.now()

        };

    }





    getAll(){

        return this.recommendations;

    }




    clear(){

        this.recommendations=[];

    }


}
