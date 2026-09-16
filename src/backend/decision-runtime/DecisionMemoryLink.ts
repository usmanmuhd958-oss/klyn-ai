export class DecisionMemoryLink {


  async store(decision:any){

    return {

      stored:true,

      decision

    };

  }

}
