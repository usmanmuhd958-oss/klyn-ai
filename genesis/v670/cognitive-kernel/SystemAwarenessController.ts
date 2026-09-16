export class SystemAwarenessController {

  observe(state:any){
    return {
      status:"system_awareness_active",
      state
    };
  }

}
