/**
 * KLYN Prime Universal Engineering Memory OS v1
 *
 * Long-term engineering knowledge archive.
 */


export type EngineeringMemoryType =
    | "code-change"
    | "architecture"
    | "bug-fix"
    | "decision"
    | "pattern";



export interface EngineeringMemory {

    id:string;

    type:EngineeringMemoryType;

    title:string;

    description:string;

    source:string;

    importance:number;

    createdAt:number;

}



export interface EngineeringInsight {

    memoryId:string;

    lesson:string;

    confidence:number;

}







export class EngineeringMemoryOS {


    private memories:
        EngineeringMemory[];


    private insights:
        EngineeringInsight[];




    constructor(){

        this.memories=[];

        this.insights=[];


        console.log(
            "[KLYN ENGINEERING MEMORY OS v1] Online"
        );

    }







    storeMemory(
        memory:EngineeringMemory
    ){

        this.memories.push(
            memory
        );


        return memory;

    }







    search(
        query:string
    ){

        return this.memories.filter(

            memory =>

            (
                memory.title
                +
                memory.description
            )
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )

        );

    }







    addInsight(
        insight:EngineeringInsight
    ){

        this.insights.push(
            insight
        );


        return insight;

    }







    recommend(
        topic:string
    ){

        const related =
            this.search(topic);



        return {

            topic,


            knowledge:
            related.map(

                item =>
                item.description

            ),


            confidence:
            related.length > 0
            ?
            0.8
            :
            0.1

        };

    }







    snapshot(){

        return {

            memories:
            this.memories,


            insights:
            this.insights,


            generatedAt:
            Date.now()

        };

    }



}
