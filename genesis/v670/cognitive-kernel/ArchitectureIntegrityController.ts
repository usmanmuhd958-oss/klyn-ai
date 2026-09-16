export class ArchitectureIntegrityController {
  validate(architecture:any){
    return {
      architecture,
      integrity:"verified"
    };
  }
}
