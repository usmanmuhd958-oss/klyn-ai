export class AdaptiveConfigurationController {

  adapt(config:string){
    return {
      config,
      adaptation:"completed"
    };
  }

}
