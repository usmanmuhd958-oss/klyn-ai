export class UpgradePlanner {
  plan(target:string){
    return {
      target,
      upgrade:"planned"
    };
  }
}
