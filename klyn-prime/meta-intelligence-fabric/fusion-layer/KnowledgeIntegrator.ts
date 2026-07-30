/**
 * KLYN Prime Knowledge Integrator
 *
 * Unified knowledge processing layer.
 * Connects memories, world models, agents and intelligence sources.
 */


export interface KnowledgeSource {

    id: string;

    domain: string;

    content: unknown;

    reliability: number;

    timestamp: number;

}



export interface KnowledgeQuery {

    domain?: string;

    keyword?: string;

}



export interface IntegratedKnowledge {

    concepts: string[];

    sources: string[];

    knowledgeMap: Record<string, unknown>;

    confidence: number;

}




export class KnowledgeIntegrator {


    private sources: KnowledgeSource[];



    constructor(){

        this.sources = [];

    }




    register(
        source: KnowledgeSource
    ): void {


        this.sources.push(source);

    }





    remove(
        id:string
    ):boolean {


        const before =
            this.sources.length;


        this.sources =
            this.sources.filter(
                source =>
                source.id !== id
            );


        return before !== this.sources.length;

    }





    integrate():
    IntegratedKnowledge {


        const concepts:string[] = [];

        const sourceIds:string[] = [];

        const knowledgeMap:
        Record<string,unknown> = {};


        let confidence = 0;



        for(
            const source of this.sources
        ){


            concepts.push(
                source.domain
            );


            sourceIds.push(
                source.id
            );


            knowledgeMap[
                source.domain
            ] =
            source.content;



            confidence +=
            source.reliability;


        }



        if(
            this.sources.length > 0
        ){

            confidence =
            confidence /
            this.sources.length;

        }



        return {

            concepts,

            sources:
            sourceIds,

            knowledgeMap,

            confidence

        };


    }





    query(
        request:KnowledgeQuery
    ):
    KnowledgeSource[] {


        return this.sources.filter(
            source => {


                const domainMatch =
                request.domain
                ?
                source.domain
                .toLowerCase()
                .includes(
                    request.domain.toLowerCase()
                )
                :
                true;



                const keywordMatch =
                request.keyword
                ?
                JSON.stringify(
                    source.content
                )
                .toLowerCase()
                .includes(
                    request.keyword.toLowerCase()
                )
                :
                true;



                return (
                    domainMatch &&
                    keywordMatch
                );


            }
        );


    }





    getKnowledgeSize():
    number {


        return this.sources.length;

    }




    clear():void {

        this.sources = [];

    }



}
