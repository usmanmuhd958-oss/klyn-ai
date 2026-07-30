export interface KnowledgeNode {

    id:string;

    type:string;

    metadata:any;

}


export class KnowledgeGraph {


    private nodes =
    new Map<string, KnowledgeNode>();


    add(node:KnowledgeNode){

        this.nodes.set(
            node.id,
            node
        );

    }


    get(id:string){

        return this.nodes.get(id);

    }


    search(type:string){

        return [
            ...this.nodes.values()
        ]
        .filter(
            n => n.type === type
        );

    }

}
