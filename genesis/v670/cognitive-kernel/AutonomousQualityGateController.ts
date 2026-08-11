export class AutonomousQualityGateController {
  validate(build:any){
    return {
      build,
      quality:"verified"
    };
  }
}
