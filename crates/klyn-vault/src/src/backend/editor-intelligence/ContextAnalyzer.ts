export class ContextAnalyzer {

  analyze(context:any){

    return {

      files:context.files || [],

      dependencies:context.dependencies || [],

      contextReady:true

    };

  }

}
