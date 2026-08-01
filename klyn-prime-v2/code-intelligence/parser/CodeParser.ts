export interface CodeFile {

    path:string;

    language:string;

    content:string;

}


export class CodeParser {


    parse(file:CodeFile){

        return {

            path:file.path,

            language:file.language,

            structure:"parsed"

        };

    }


}
