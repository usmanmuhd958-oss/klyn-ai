/**
 * KLYN Prime Neural Context Fabric v1
 *
 * Unified intelligence context layer.
 */


export type ContextSource =
    | "memory"
    | "knowledge"
    | "world-model"
    | "agent"
    | "decision";



export interface ContextItem {

    id:string;

    source:ContextSource;

    content:string;

    relevance:number;

    timestamp:number;

}



export interface IntelligenceContext {

    request:string;

    items:ContextItem[];

    confidence:number;

    generatedAt:number;

}







export class ContextFabric {


    private contextStore:
        ContextItem[];




    constructor(){

        this.contextStore=[];


        console.log(
            "[KLYN NEURAL CONTEXT FABRIC v1] Online"
        );

    }







    ingest(
        item:ContextItem
    ){

        this.contextStore.push(
            item
        );


        return item;

    }







    retrieve(
        query:string
    ){

        return this.contextStore.filter(

            item =>

            item.content
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )

        );

    }







    rank(
        items:ContextItem[]
    ){

        return items.sort(

            (a,b)=>

            b.relevance -
            a.relevance

        );

    }







    buildContext(
        request:string
    ):IntelligenceContext{


        const results =
            this.rank(
                this.retrieve(request)
            );



        const confidence =
            results.length === 0
            ?
            0
            :
            Math.min(
                results.length / 10,
                1
            );



        return {


            request,


            items:
            results,


            confidence,


            generatedAt:
            Date.now()


        };

    }







    snapshot(){

        return this.contextStore;

    }



}
