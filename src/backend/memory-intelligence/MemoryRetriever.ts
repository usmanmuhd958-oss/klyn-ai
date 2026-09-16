export class MemoryRetriever {


  retrieve(query:any, memories:any[]){

    return {

      query,

      results:memories

    };

  }

}
