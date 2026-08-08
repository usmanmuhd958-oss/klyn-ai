export class UpgradeEngine {
  upgrade(component:string){
    return {
      component,
      upgraded:true
    };
  }
}
