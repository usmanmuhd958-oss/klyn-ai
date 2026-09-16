export class AgentRuntimeTraceController {
  trace(event:any){
    return {
      event,
      traced:true
    };
  }
}
