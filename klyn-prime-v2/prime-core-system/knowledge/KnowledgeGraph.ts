export interface KnowledgeNode {

    id:string;

    type:string;

    data:any;

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


    query(type:string){

        return [
            ...this.nodes.values()
        ]
        .filter(
            node =>
            node.type === type
        );

    }


    all(){

        return [
            ...this.nodes.values()
        ];

    }

}
