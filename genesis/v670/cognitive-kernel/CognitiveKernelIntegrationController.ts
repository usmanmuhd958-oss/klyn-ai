export class CognitiveKernelIntegrationController {

  integrate(module:string){
    return {
      module,
      integrated:true
    };
  }

}
