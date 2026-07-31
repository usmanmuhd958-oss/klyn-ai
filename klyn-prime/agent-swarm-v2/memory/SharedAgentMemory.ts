/**
 * KLYN Prime Shared Agent Memory
 *
 * Collective knowledge storage for agent swarm.
 */


export type MemoryCategory =
    | "solution"
    | "lesson"
    | "pattern"
    | "failure"
    | "discovery";




export interface MemoryRecord {

    id:string;

    agentId:string;

    category:MemoryCategory;

    title:string;

    content:string;

    importance:number;

    timestamp:number;

}






export class SharedAgentMemory {


    private memories:
        MemoryRecord[];




    constructor(){

        this.memories=[];

        console.log(
            "[KLYN MEMORY FABRIC] Initialized"
        );

    }







    remember(
        record:MemoryRecord
    ){

        this.memories.push(
            record
        );

    }







    search(
        query:string
    )
    :
    MemoryRecord[] {


        return this.memories.filter(
            memory =>

            memory.title
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )

            ||

            memory.content
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )

        );


    }







    getByCategory(
        category:MemoryCategory
    ){

        return this.memories.filter(
            item =>
            item.category === category
        );

    }







    mostImportant(
        limit:number = 10
    ){

        return [

            ...this.memories

        ]

        .sort(
            (a,b)=>
            b.importance -
            a.importance
        )

        .slice(
            0,
            limit
        );


    }







    export(){

        return this.memories;

    }



}
