/**
 * KLYN Prime Autonomous Learning Engine v2
 *
 * Experience-based improvement foundation.
 */


export type ExperienceResult =
    | "success"
    | "failure"
    | "partial";



export interface ExperienceRecord {

    id:string;

    task:string;

    action:string;

    result:ExperienceResult;

    score:number;

    lessons:string[];

    timestamp:number;

}





export interface LearningPattern {

    id:string;

    category:string;

    frequency:number;

    confidence:number;

}







export class ExperienceMemory {


    private experiences:
        ExperienceRecord[];


    private patterns:
        LearningPattern[];




    constructor(){

        this.experiences=[];

        this.patterns=[];


        console.log(
            "[KLYN AUTONOMOUS LEARNING v2] Online"
        );

    }







    recordExperience(
        task:string,
        action:string,
        result:ExperienceResult,
        score:number,
        lessons:string[]
    ){


        const experience:ExperienceRecord = {


            id:
            crypto.randomUUID(),


            task,


            action,


            result,


            score,


            lessons,


            timestamp:
            Date.now()


        };


        this.experiences.push(
            experience
        );


        return experience;

    }







    analyzePerformance(){

        const total =
            this.experiences.length;


        const success =
            this.experiences.filter(

                item =>
                item.result === "success"

            ).length;



        return {


            total,


            successRate:
            total === 0
            ?
            0
            :
            success / total



        };

    }







    extractPatterns(){

        const map =
            new Map<string,number>();


        for(
            const experience
            of this.experiences
        ){

            for(
                const lesson
                of experience.lessons
            ){

                map.set(
                    lesson,
                    (map.get(lesson) || 0) + 1
                );

            }

        }



        this.patterns =
            Array.from(
                map.entries()
            )
            .map(

                ([category,frequency]) => ({

                    id:
                    crypto.randomUUID(),

                    category,

                    frequency,

                    confidence:
                    Math.min(
                        frequency / 10,
                        1
                    )

                })

            );



        return this.patterns;

    }







    recommend(){

        return this.patterns
            .sort(

                (a,b)=>
                b.confidence -
                a.confidence

            );

    }







    snapshot(){

        return {

            experiences:
            this.experiences,


            patterns:
            this.patterns

        };

    }



}
