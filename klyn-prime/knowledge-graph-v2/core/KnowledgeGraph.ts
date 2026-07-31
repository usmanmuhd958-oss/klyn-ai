/**
 * KLYN Prime Enterprise Knowledge Graph v2
 *
 * Relationship-based intelligence foundation.
 */


export type KnowledgeType =
    | "project"
    | "agent"
    | "file"
    | "decision"
    | "concept"
    | "event";



export interface KnowledgeNode {

    id:string;

    type:KnowledgeType;

    label:string;

    content:string;

    importance:number;

    createdAt:number;

}



export interface KnowledgeRelation {

    id:string;

    from:string;

    to:string;

    relation:string;

    weight:number;

}







export interface KnowledgeQuery {

    term:string;

    limit:number;

}







export class KnowledgeGraph {


    private nodes:
        KnowledgeNode[];


    private relations:
        KnowledgeRelation[];




    constructor(){

        this.nodes=[];

        this.relations=[];


        console.log(
            "[KLYN KNOWLEDGE GRAPH v2] Online"
        );

    }







    addNode(
        node:KnowledgeNode
    ){

        this.nodes.push(
            node
        );


        return node;

    }







    addRelation(
        relation:KnowledgeRelation
    ){

        this.relations.push(
            relation
        );


        return relation;

    }







    search(
        query:KnowledgeQuery
    ){

        return this.nodes

            .filter(

                node =>

                node.content
                .toLowerCase()
                .includes(
                    query.term.toLowerCase()
                )

            )

            .slice(
                0,
                query.limit
            );

    }







    getConnections(
        nodeId:string
    ){

        return this.relations.filter(

            relation =>

            relation.from === nodeId
            ||
            relation.to === nodeId

        );

    }







    importanceRanking(){

        return this.nodes.sort(

            (a,b)=>

            b.importance -
            a.importance

        );

    }







    snapshot(){

        return {

            nodes:
            this.nodes,


            relations:
            this.relations,


            generatedAt:
            Date.now()

        };

    }



}
