export interface IntelligenceNode {

    id:string;

    type:string;

    process(input:any):Promise<any>;

}


export class IntelligenceMesh {


    private nodes =
    new Map<string, IntelligenceNode>();


    register(node:IntelligenceNode){

        this.nodes.set(
            node.id,
            node
        );

        console.log(
          `[MESH] Node connected: ${node.id}`
        );

    }


    async dispatch(
        target:string,
        input:any
    ){

        const node =
        this.nodes.get(target);


        if(!node){

            throw new Error(
              "Node unavailable"
            );

        }


        return await node.process(input);

    }


    nodesList(){

        return [
            ...this.nodes.keys()
        ];

    }

}
