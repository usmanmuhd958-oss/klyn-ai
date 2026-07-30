/**
 * KLYN Prime Reasoning Engine v3
 * Thought Graph Memory
 *
 * Represents connected reasoning paths.
 */


export interface ThoughtNode {

    id:string;

    concept:string;

    confidence:number;

    evidence:string[];

    connections:string[];

}



export class ThoughtGraph {


    private nodes:
        Map<string, ThoughtNode>;



    constructor(){

        this.nodes = new Map();

    }



    addThought(
        node:ThoughtNode
    ):void{


        this.nodes.set(
            node.id,
            node
        );

    }



    connect(
        source:string,
        target:string
    ):void{


        const node =
            this.nodes.get(source);


        if(!node){

            throw new Error(
                "Source thought not found"
            );

        }


        node.connections.push(target);


    }



    findThought(
        id:string
    ):


    ThoughtNode | undefined {


        return this.nodes.get(id);

    }



    getReasoningChain(
        start:string
    ):ThoughtNode[]{


        const result:ThoughtNode[]=[];


        let current =
            this.nodes.get(start);



        while(current){


            result.push(current);


            const next =
                current.connections[0];


            if(!next){

                break;

            }


            current =
                this.nodes.get(next);

        }



        return result;

    }



    inspect(){

        return {

            totalNodes:
            this.nodes.size,


            graph:
            Array.from(
                this.nodes.values()
            )

        };

    }



}
