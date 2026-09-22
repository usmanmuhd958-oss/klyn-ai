export class InferenceExecutor {


  async execute(request:any){

    return {

      success:true,

      output:"inference-complete",

      request

    };

  }


}
