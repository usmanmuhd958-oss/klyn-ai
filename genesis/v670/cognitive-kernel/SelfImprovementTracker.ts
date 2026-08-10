export class SelfImprovementTracker {
  track(progress:string){
    return {
      status:"tracked",
      progress
    };
  }
}
