export class CognitiveCore {

  state:any = {};

  think(input:string){
    return {
      thought:"processed",
      input
    };
  }

  updateState(data:any){
    this.state=data;
  }
}
