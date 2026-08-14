export interface ASTSymbol {

name:string;

kind:
 "function"
 | "class"
 | "variable";

}


export class ASTIntelligence {


analyze(code:string):ASTSymbol[]{


const symbols:ASTSymbol[]=[];


if(code.includes("function")){

symbols.push({

name:"detected_function",

kind:"function"

});

}


return symbols;

}


}
