export class AccessValidator {

  validate(identity:any){

    return {
      authenticated:true,
      identity
    };

  }

}
