/**
 * KLYN Prime Autonomous Memory & Learning Fabric v3
 *
 * Long-term intelligence memory foundation.
 */


export type MemoryType =
    | "experience"
    | "decision"
    | "failure"
    | "pattern";



export interface MemoryRecord {

    id:string;

    type:MemoryType;

    agentId:string;

    title:string;

    content:string;

    importance:number;

    createdAt:number;

}



export interface LearningSignal {

    memoryId:string;

    lesson:string;

    confidence:number;

}







export class MemoryFabric {


    private memories:
        MemoryRecord[];


    private lessons:
        LearningSignal[];




    constructor(){

        this.memories=[];

        this.lessons=[];


        console.log(
            "[KLYN MEMORY LEARNING FABRIC v3] Online"
        );

    }







    store(
        memory:MemoryRecord
    ){

        this.memories.push(
            memory
        );


        return memory;

    }







    retrieve(
        keyword:string
    ){

        return this.memories.filter(

            memory =>

            memory.content
            .toLowerCase()
            .includes(
                keyword.toLowerCase()
            )

        );

    }







    extractLesson(
        memoryId:string,
        lesson:string,
        confidence:number
    ){

        const signal:LearningSignal = {


            memoryId,


            lesson,


            confidence


        };


        this.lessons.push(
            signal
        );


        return signal;

    }







    rankKnowledge(){

        return this.memories.sort(

            (a,b)=>

            b.importance -
            a.importance

        );

    }







    learningReport(){

        return {

            memories:
            this.memories,


            lessons:
            this.lessons,


            generatedAt:
            Date.now()

        };

    }



}
