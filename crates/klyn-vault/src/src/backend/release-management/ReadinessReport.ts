export class ReadinessReport {


  generate(status:any){

    return {

      status,

      readiness:"approved"

    };

  }


}
