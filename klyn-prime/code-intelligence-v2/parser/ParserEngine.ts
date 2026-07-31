/**
 * KLYN Prime Code Intelligence v2
 *
 * Parser Intelligence Engine
 *
 * Extracts structural knowledge from source code.
 */


export interface ParseRequest {

    filePath:string;

    language:string;

    content:string;

}



export interface ParsedSymbol {

    name:string;

    type:
        | "class"
        | "function"
        | "interface"
        | "variable";

    line:number;

}



export interface ParseResult {

    file:string;

    imports:string[];

    symbols:ParsedSymbol[];

    dependencies:string[];

    timestamp:number;

}




export class ParserEngine {


    private history:ParseResult[];



    constructor(){

        this.history=[];

    }




    parse(
        request:ParseRequest
    ):ParseResult {


        const result:ParseResult = {


            file:
                request.filePath,


            imports:
                this.extractImports(
                    request.content
                ),



            symbols:
                this.extractSymbols(
                    request.content
                ),



            dependencies:
                this.extractDependencies(
                    request.content
                ),



            timestamp:
                Date.now()

        };



        this.history.push(result);


        return result;

    }





    private extractImports(
        code:string
    ):string[] {


        const imports:string[]=[];


        const lines =
            code.split("\n");


        for(
            const line of lines
        ){

            if(
                line.includes("import")
            ){

                imports.push(
                    line.trim()
                );

            }

        }


        return imports;

    }





    private extractSymbols(
        code:string
    ):ParsedSymbol[] {


        const symbols:ParsedSymbol[]=[];


        const lines =
            code.split("\n");



        lines.forEach(
            (line,index)=>{


                if(
                    line.includes("class ")
                ){

                    symbols.push({

                        name:
                            line
                            .split("class ")[1]
                            ?.split(" ")[0]
                            || "Unknown",


                        type:
                            "class",


                        line:
                            index + 1

                    });

                }



                if(
                    line.includes("function ")
                ){

                    symbols.push({

                        name:
                            line
                            .split("function ")[1]
                            ?.split("(")[0]
                            || "Unknown",


                        type:
                            "function",


                        line:
                            index + 1

                    });

                }


            }
        );


        return symbols;

    }





    private extractDependencies(
        code:string
    ):string[] {


        return this.extractImports(code);

    }





    getHistory(){

        return this.history;

    }


}
