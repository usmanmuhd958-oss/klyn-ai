export class AutonomousControlAuthorityController {
  control(resource:any){
    return {
      resource,
      authority:"autonomous"
    };
  }
}
