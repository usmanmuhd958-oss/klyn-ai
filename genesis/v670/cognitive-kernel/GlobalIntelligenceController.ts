export class GlobalIntelligenceController {

  control(signal:any){
    return {
      status:"global_control_active",
      signal
    };
  }

}
