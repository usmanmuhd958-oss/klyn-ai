
export type Node = {

 id:string;

 dependencies:string[];

};


export class DependencyGraph {


 private nodes =
 new Map<string,Node>();


 add(node:Node){

    this.nodes.set(
       node.id,
       node
    );

 }


 get(id:string){

    return this.nodes.get(id);

 }


 all(){

    return [...this.nodes.values()];

 }


}

