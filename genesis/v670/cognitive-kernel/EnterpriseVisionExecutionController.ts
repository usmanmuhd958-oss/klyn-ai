export class EnterpriseVisionExecutionController {
  execute(vision:any){
    return {
      vision,
      execution:"planned"
    };
  }
}
