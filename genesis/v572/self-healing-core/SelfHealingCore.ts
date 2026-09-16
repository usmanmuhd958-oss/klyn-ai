export class SelfHealingCore {
  heal(system:any){
    return {
      system,
      healing:"initiated"
    };
  }
}
