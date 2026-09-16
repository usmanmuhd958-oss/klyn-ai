export class SystemArchitectureDecisionController {
  decide(architecture:any){
    return {
      architecture,
      decision:"approved"
    };
  }
}
