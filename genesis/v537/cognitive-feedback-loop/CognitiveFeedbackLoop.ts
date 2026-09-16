export class CognitiveFeedbackLoop {

  history:any[]=[];

  evaluate(result:any){

    this.history.push(result);

    return {
      feedback:"generated",
      result
    };
  }
}
