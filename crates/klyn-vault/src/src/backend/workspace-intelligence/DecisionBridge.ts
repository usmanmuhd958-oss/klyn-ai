export class DecisionBridge {

  decide(context:any){

    return {
      decision:"generated",
      context
    };

  }

}
