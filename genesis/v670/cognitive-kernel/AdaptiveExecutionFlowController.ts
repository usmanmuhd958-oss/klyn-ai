export class AdaptiveExecutionFlowController {
  adapt(context:any){
    return {
      context,
      flow:"adaptive"
    };
  }
}
