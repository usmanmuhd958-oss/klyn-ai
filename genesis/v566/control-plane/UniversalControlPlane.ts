export class UniversalControlPlane {
  control(system:any){
    return {
      system,
      controlled:true
    };
  }
}
