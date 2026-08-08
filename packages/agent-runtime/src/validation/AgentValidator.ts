export class AgentValidator {

  validate(result:any){

    return {
      valid:
        result !== undefined &&
        result !== null,

      timestamp: Date.now()
    };

  }

}
