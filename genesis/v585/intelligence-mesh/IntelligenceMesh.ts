export class IntelligenceMesh {

    nodes:string[];

    constructor(){
        this.nodes=[];
    }

    connect(node:string){
        this.nodes.push(node);
    }

    topology(){
        return {
            nodes:this.nodes,
            mesh:"distributed"
        };
    }
}
