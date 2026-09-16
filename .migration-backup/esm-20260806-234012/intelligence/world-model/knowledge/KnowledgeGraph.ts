
export interface Knowledge {

 entity:string;

 relation:string;

 target:string;

}


export class KnowledgeGraph {


 private data:Knowledge[]=[];


 add(item:Knowledge){

    this.data.push(item);

 }


 query(entity:string){

    return this.data.filter(
      x=>x.entity===entity
    );

 }


}

