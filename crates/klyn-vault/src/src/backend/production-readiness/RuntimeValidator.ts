export class RuntimeValidator {

  validate(runtime:any){

    return {

      runtime,

      validated:true,

      status:"ready"

    };

  }

}
