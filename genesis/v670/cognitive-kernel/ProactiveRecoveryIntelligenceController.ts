export class ProactiveRecoveryIntelligenceController {

  recover(issue:string){
    return {
      issue,
      action:"planned"
    };
  }

}
