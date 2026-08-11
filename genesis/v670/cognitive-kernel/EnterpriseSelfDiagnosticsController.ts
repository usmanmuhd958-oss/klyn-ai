export class EnterpriseSelfDiagnosticsController {
  diagnose(runtime:any){
    return {
      runtime,
      healthy:true
    };
  }
}
