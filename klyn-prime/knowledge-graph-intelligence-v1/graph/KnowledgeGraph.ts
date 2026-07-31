/**
 * KLYN Prime Knowledge Graph Intelligence v1
 *
 * Internal knowledge relationship engine.
 */


export type KnowledgeType =
    | "code"
    | "architecture"
    | "agent"
    | "decision"
    | "documentation"
    | "memory";



export interface KnowledgeNode {

    id:string;

    title:string;

    type:KnowledgeType;

    content:string;

    metadata:Record<string,unknown>;

    createdAt:number;

}




export interface KnowledgeEdge {

    from:string;

    to:string;

    relationship:
        | "depends_on"
        | "related_to"
        | "created_by"
        | "improves"
        | "explains";

}







export class KnowledgeGraph {


    private nodes:
        KnowledgeNode[];


    private edges:
        KnowledgeEdge[];




    constructor(){

        this.nodes=[];

        this.edges=[];


        console.log(
            "[KLYN KNOWLEDGE GRAPH v1] Online"
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







    connect(
        edge:KnowledgeEdge
    ){

        this.edges.push(
            edge
        );


    }







    search(
        query:string
    ){

        return this.nodes.filter(

            node =>
            node.title
            .toLowerCase()
            .includes(
                query.toLowerCase()
            )

        );

    }







    relatedNodes(
        id:string
    ){

        return this.edges.filter(

            edge =>
            edge.from === id
            ||
            edge.to === id

        );

    }







    synthesize(){

        return {


            totalNodes:
            this.nodes.length,


            totalRelationships:
            this.edges.length,


            generatedAt:
            Date.now()

        };

    }







    snapshot(){

        return {

            nodes:
            this.nodes,


            edges:
            this.edges

        };

    }



}
