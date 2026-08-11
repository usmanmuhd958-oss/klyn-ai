export class AutomatedEngineeringPipelineController {
  execute(pipeline:any){
    return {
      pipeline,
      status:"executing"
    };
  }
}
