/**
 * KLYN Prime Code Intelligence v2
 *
 * Project Knowledge Graph
 *
 * Purpose:
 * Build an internal representation of a software system.
 */


export type NodeType =
    | "file"
    | "module"
    | "service"
    | "database"
    | "api"
    | "component";



export interface KnowledgeNode {

    id:string;

    name:string;

    type:NodeType;

    metadata:Record<string, unknown>;

}



export interface KnowledgeEdge {

    from:string;

    to:string;

    relationship:
        | "imports"
        | "depends_on"
        | "calls"
        | "extends"
        | "implements";

}



export interface ProjectSnapshot {

    nodes:KnowledgeNode[];

    edges:KnowledgeEdge[];

    timestamp:number;

}




export class ProjectKnowledgeGraph {


    private nodes:Map<string,KnowledgeNode>;

    private edges:KnowledgeEdge[];




    constructor(){

        this.nodes = new Map();

        this.edges = [];

    }




    addNode(
        node:KnowledgeNode
    ):void {


        this.nodes.set(
            node.id,
            node
        );

    }





    addRelationship(
        edge:KnowledgeEdge
    ):void {


        this.edges.push(edge);

    }





    getNode(
        id:string
    ):KnowledgeNode | undefined {


        return this.nodes.get(id);

    }





    getDependencies(
        nodeId:string
    ):KnowledgeNode[] {


        const results:KnowledgeNode[]=[];


        for(
            const edge of this.edges
        ){

            if(
                edge.from === nodeId &&
                edge.relationship === "depends_on"
            ){

                const target =
                    this.nodes.get(edge.to);


                if(target){

                    results.push(target);

                }

            }

        }


        return results;

    }





    analyzeArchitecture(){

        return {

            totalNodes:
                this.nodes.size,


            totalRelationships:
                this.edges.length,


            generatedAt:
                Date.now()

        };

    }





    snapshot():ProjectSnapshot {


        return {


            nodes:
                Array.from(
                    this.nodes.values()
                ),


            edges:
                this.edges,


            timestamp:
                Date.now()

        };

    }



}
