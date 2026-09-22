import { CodeSymbol } from "./CodeSymbol.js";


export class SymbolIndexer {


 private symbols:CodeSymbol[]=[];


 add(symbol:CodeSymbol){

  this.symbols.push(symbol);

 }


 search(name:string){

  return this.symbols.filter(
   s=>s.name.includes(name)
  );

 }


}
