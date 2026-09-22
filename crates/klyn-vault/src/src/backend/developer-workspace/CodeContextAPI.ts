export class CodeContextAPI {


  analyze(file:string){

    return {

      file,

      context:"loaded"

    };

  }


}
