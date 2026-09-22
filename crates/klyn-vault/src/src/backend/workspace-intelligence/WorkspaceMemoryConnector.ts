export class WorkspaceMemoryConnector {


  store(memory:any){

    return {

      stored:true,

      memory

    };

  }


  retrieve(query:any){

    return {

      query,

      memories:[]

    };

  }


}
