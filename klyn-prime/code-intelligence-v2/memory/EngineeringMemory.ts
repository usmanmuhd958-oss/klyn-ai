/**
 * KLYN Prime Code Intelligence v2
 *
 * Engineering Memory System
 *
 * Stores engineering knowledge,
 * decisions, discoveries and lessons.
 */


export type MemoryType =
    | "architecture"
    | "bug"
    | "optimization"
    | "security"
    | "pattern";



export interface MemoryRecord {

    id:string;

    type:MemoryType;

    title:string;

    description:string;

    tags:string[];

    confidence:number;

    createdAt:number;

}



export interface MemoryQuery {

    type?:MemoryType;

    tag?:string;

    keyword?:string;

}





export class EngineeringMemory {


    private memories:Map<string,MemoryRecord>;




    constructor(){

        this.memories =
            new Map();

    }





    store(
        record:MemoryRecord
    ):void {


        this.memories.set(
            record.id,
            record
        );

    }





    recall(
        query:MemoryQuery
    ):MemoryRecord[] {


        const results:
            MemoryRecord[] = [];



        for(
            const memory of this.memories.values()
        ){



            if(
                query.type &&
                memory.type !== query.type
            ){

                continue;

            }



            if(
                query.tag &&
                !memory.tags.includes(
                    query.tag
                )
            ){

                continue;

            }




            if(
                query.keyword &&
                !memory.title
                    .toLowerCase()
                    .includes(
                        query.keyword.toLowerCase()
                    )
            ){

                continue;

            }



            results.push(
                memory
            );

        }



        return results;

    }





    learn(
        type:MemoryType,
        title:string,
        description:string
    ):MemoryRecord {


        const memory:MemoryRecord = {


            id:
                crypto.randomUUID(),


            type,


            title,


            description,


            tags:
                [],


            confidence:
                0.8,


            createdAt:
                Date.now()

        };



        this.store(
            memory
        );



        return memory;

    }





    improveConfidence(
        id:string,
        value:number
    ){


        const memory =
            this.memories.get(id);



        if(!memory){

            return;

        }



        memory.confidence =
            Math.min(
                1,
                memory.confidence + value
            );


    }





    exportKnowledge(){

        return Array.from(
            this.memories.values()
        );

    }



}
