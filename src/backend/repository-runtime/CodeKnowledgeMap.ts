export class CodeKnowledgeMap {

  private symbols:any[]=[];


  index(symbol:any){

    this.symbols.push(symbol);

  }


  query(){

    return this.symbols;

  }

}
