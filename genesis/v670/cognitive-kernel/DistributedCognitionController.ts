export class DistributedCognitionController {

  coordinate(cognition:any){
    return {
      status:"distributed_cognition_active",
      cognition
    };
  }

}
